// Fail-closed policy of the semantic governance audit: profile validation, response validation, and the derivation
// of findings from Jev's typed answers. Pure functions only; no I/O, no network.
//
// Jev answers are probabilistic typed judgments, not proof. This module turns them into findings under an explicit,
// versioned policy: a finding is derived from the probability mass on the options the profile maps to that finding,
// compared against the bands the profile states for that question. With no calibrated bands, no answer can be
// NO_FINDING.
//
// NO_FINDING is the formal success label: no semantic finding was produced within the bounded questions evaluated.
// It does not mean correct, approved, complete, certified, or legally or regulatorily valid.

export const EXIT = {
  NO_FINDING: 0,
  GOVERNANCE_CONFLICT_OR_POLICY_FAIL: 2,
  BLOCKED_PROVIDER_OR_MODEL: 3,
  BLOCKED_PROFILE_OR_RESPONSE_INVALID: 4,
  BLOCKED_EGRESS_OR_PREFLIGHT: 5,
  REQUIRES_HUMAN_REVIEW: 6,
} as const;

export type BlockedStatus = 'BLOCKED_PROVIDER_OR_MODEL' | 'BLOCKED_PROFILE_OR_RESPONSE_INVALID' | 'BLOCKED_EGRESS_OR_PREFLIGHT';
// RESOLVED_CONFLICT: a contradiction that the AGENTS.md section 1 order settles. The higher authority decides what an
// agent does, but section 1 also requires the conflict to be surfaced, so it is never NO_FINDING; it maps to exit 6.
export type FindingKind = 'CONFLICT' | 'RESOLVED_CONFLICT' | 'INSUFFICIENT' | 'REVIEW';
export type Finding = 'NO_FINDING' | FindingKind | 'UNCALIBRATED';

export class Blocked extends Error {
  readonly status: BlockedStatus;
  constructor(status: BlockedStatus, message: string) {
    super(message);
    this.name = 'Blocked';
    this.status = status;
  }
}

export type NoulQuestion = {
  readonly type: 'noul';
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
  readonly findings: { readonly true?: FindingKind; readonly false?: FindingKind };
  readonly applies_to_tag?: string;
};
export type ChoiceQuestion = {
  readonly type: 'choice';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
  readonly findings: Readonly<Record<string, FindingKind>>;
  readonly applies_to_tag?: string;
};
export type Question = NoulQuestion | ChoiceQuestion;
export type Bands = { readonly review: number; readonly finding: number };
// One pair of bands per question, derived from that question's own calibration answers: the questions use different
// primitives and options, so their probability distributions are not comparable and are never pooled.
export type QuestionBands = Readonly<Record<string, Bands>>;

export type Profile = {
  readonly profile_id: string;
  readonly version: string;
  readonly model: string;
  readonly bands: QuestionBands | null;
  readonly unit_questions: Readonly<Record<string, Question>>;
  readonly pair_questions: Readonly<Record<string, Question>>;
};

export type NoulAnswer = { readonly type: 'noul'; readonly noul: number };
export type ChoiceAnswer = { readonly type: 'choice'; readonly choice: string; readonly probabilities: Readonly<Record<string, number>>; readonly confidence: number };
export type Answer = NoulAnswer | ChoiceAnswer;
export type Usage = { readonly input_tokens: number; readonly output_tokens: number };
export type ValidResponse = { readonly model: string; readonly answers: Readonly<Record<string, Answer>>; readonly usage: Usage };

const FINDING_KINDS = new Set<string>(['CONFLICT', 'RESOLVED_CONFLICT', 'INSUFFICIENT', 'REVIEW']);
// A pinned release id only: an alias such as jev-latest can move under a calibrated profile.
const PINNED_MODEL = /^jev-\d+\.\d+\.\d+$/;
// The probabilities of one answer are rounded by the provider; they must still describe one distribution.
const PROBABILITY_SUM_TOLERANCE = 0.02;

const invalidProfile = (message: string): never => {
  throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `profile: ${message}`);
};
const invalidResponse = (message: string): never => {
  throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `response: ${message}`);
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[], where: string, fail: (m: string) => never): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) fail(`${where}: unexpected field '${key}'`);
  for (const key of required) if (!(key in record)) fail(`${where}: missing field '${key}'`);
}

function nonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') invalidProfile(`${where} must be a non-empty string`);
  return value as string;
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateQuestion(id: string, raw: unknown): Question {
  const where = `question '${id}'`;
  if (!isRecord(raw)) return invalidProfile(`${where} must be an object`);
  exactKeys(raw, ['type', 'instructions', 'criteria', 'findings', 'applies_to_tag'], ['type', 'instructions', 'criteria', 'findings'], where, invalidProfile);
  nonEmptyString(raw.instructions, `${where}.instructions`);
  if (raw.applies_to_tag !== undefined) nonEmptyString(raw.applies_to_tag, `${where}.applies_to_tag`);
  if (!isRecord(raw.criteria)) return invalidProfile(`${where}.criteria must be an object`);
  if (!isRecord(raw.findings)) return invalidProfile(`${where}.findings must be an object`);

  let options: string[];
  if (raw.type === 'noul') {
    exactKeys(raw.criteria, ['true', 'false'], ['true', 'false'], `${where}.criteria`, invalidProfile);
    options = ['true', 'false'];
  } else if (raw.type === 'choice') {
    options = Object.keys(raw.criteria);
    if (options.length < 2 || options.length > 255) invalidProfile(`${where} needs 2 to 255 options`);
  } else {
    return invalidProfile(`${where} has unsupported type '${String(raw.type)}'`);
  }
  for (const option of options) nonEmptyString(raw.criteria[option], `${where}.criteria.${option}`);
  for (const [option, kind] of Object.entries(raw.findings)) {
    if (!options.includes(option)) invalidProfile(`${where}.findings names unknown option '${option}'`);
    if (typeof kind !== 'string' || !FINDING_KINDS.has(kind)) invalidProfile(`${where}.findings.${option} is not a finding kind`);
  }
  if (Object.keys(raw.findings).length === 0) invalidProfile(`${where} maps no option to a finding, so it could never fail`);
  if (Object.keys(raw.findings).length === options.length) invalidProfile(`${where} maps every option to a finding, so it could never yield NO_FINDING`);
  return raw as Question;
}

export function validateProfile(raw: unknown): Profile {
  if (!isRecord(raw)) return invalidProfile('must be an object');
  exactKeys(raw, ['profile_id', 'version', 'model', 'bands', 'unit_questions', 'pair_questions'], ['profile_id', 'version', 'model', 'bands', 'unit_questions', 'pair_questions'], 'profile', invalidProfile);
  nonEmptyString(raw.profile_id, 'profile_id');
  nonEmptyString(raw.version, 'version');
  if (typeof raw.model !== 'string' || !PINNED_MODEL.test(raw.model)) invalidProfile(`model must be a pinned release id (got '${String(raw.model)}')`);

  const ids: string[] = [];
  for (const group of ['unit_questions', 'pair_questions'] as const) {
    const questions = raw[group];
    if (!isRecord(questions)) return invalidProfile(`${group} must be an object`);
    for (const [id, question] of Object.entries(questions)) {
      if (ids.includes(id)) invalidProfile(`question id '${id}' is used twice`);
      validateQuestion(id, question);
      ids.push(id);
    }
  }
  if (ids.length === 0) invalidProfile('has no questions; an empty profile can never yield NO_FINDING');

  // Bands are null (uncalibrated) or exactly one pair per question; there is no global or default band.
  if (raw.bands !== null) {
    if (!isRecord(raw.bands)) return invalidProfile('bands must be null or an object keyed by question id');
    exactKeys(raw.bands, ids, ids, 'bands', invalidProfile);
    for (const id of ids) {
      const bands = raw.bands[id];
      if (!isRecord(bands)) return invalidProfile(`bands.${id} must be an object`);
      exactKeys(bands, ['review', 'finding'], ['review', 'finding'], `bands.${id}`, invalidProfile);
      const { review, finding } = bands;
      if (!isProbability(review) || !isProbability(finding) || !(review > 0 && review < finding)) invalidProfile(`bands.${id} need 0 < review < finding <= 1`);
    }
  }
  return raw as Profile;
}

/** The question objects as the API expects them: policy fields stay local and are never sent. */
export function toApiQuestions(questions: Readonly<Record<string, Question>>): Record<string, { type: string; instructions: string; criteria: unknown }> {
  return Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { type: q.type, instructions: q.instructions, criteria: q.criteria }]));
}

/**
 * Validates one parsed response body against exactly the questions that were asked. Every missing, extra or
 * malformed answer blocks; a model other than the requested one blocks as a provider/model failure.
 */
export function validateResponse(raw: unknown, requestedModel: string, questions: Readonly<Record<string, Question>>): ValidResponse {
  if (!isRecord(raw)) return invalidResponse('body is not an object');
  exactKeys(raw, ['model', 'answers', 'usage'], ['model', 'answers', 'usage'], 'body', invalidResponse);
  if (typeof raw.model !== 'string') return invalidResponse('model is not a string');
  if (raw.model !== requestedModel) throw new Blocked('BLOCKED_PROVIDER_OR_MODEL', `resolved model '${raw.model}' differs from requested '${requestedModel}'`);

  if (!isRecord(raw.usage)) return invalidResponse('usage is not an object');
  exactKeys(raw.usage, ['input_tokens', 'output_tokens'], ['input_tokens', 'output_tokens'], 'usage', invalidResponse);
  for (const field of ['input_tokens', 'output_tokens'] as const) {
    const value = raw.usage[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalidResponse(`usage.${field} is not a non-negative integer`);
  }

  if (!isRecord(raw.answers)) return invalidResponse('answers is not an object');
  const asked = Object.keys(questions);
  for (const id of Object.keys(raw.answers)) if (!asked.includes(id)) invalidResponse(`unexpected answer '${id}'`);
  for (const id of asked) if (!(id in raw.answers)) invalidResponse(`missing answer '${id}'`);

  for (const [id, question] of Object.entries(questions)) {
    const answer = raw.answers[id];
    const where = `answer '${id}'`;
    if (!isRecord(answer)) return invalidResponse(`${where} is not an object`);
    if (answer.type !== question.type) invalidResponse(`${where} has type '${String(answer.type)}', expected '${question.type}'`);
    if (question.type === 'noul') {
      exactKeys(answer, ['type', 'noul'], ['type', 'noul'], where, invalidResponse);
      if (!isProbability(answer.noul)) invalidResponse(`${where}.noul is not a probability`);
    } else {
      exactKeys(answer, ['type', 'choice', 'probabilities', 'confidence'], ['type', 'choice', 'probabilities', 'confidence'], where, invalidResponse);
      const options = Object.keys(question.criteria);
      if (typeof answer.choice !== 'string' || !options.includes(answer.choice)) invalidResponse(`${where}.choice is not one of the options`);
      if (!isProbability(answer.confidence)) invalidResponse(`${where}.confidence is not a probability`);
      if (!isRecord(answer.probabilities)) return invalidResponse(`${where}.probabilities is not an object`);
      exactKeys(answer.probabilities, options, options, `${where}.probabilities`, invalidResponse);
      let sum = 0;
      for (const option of options) {
        const p = answer.probabilities[option];
        if (!isProbability(p)) return invalidResponse(`${where}.probabilities.${option} is not a probability`);
        sum += p;
      }
      if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) invalidResponse(`${where}.probabilities sum to ${sum}, not 1`);
    }
  }
  return raw as ValidResponse;
}

/** Probability of each option: for a Noul, 'true' is its probability and 'false' the complement. */
export function optionProbabilities(answer: Answer): Record<string, number> {
  return answer.type === 'noul' ? { true: answer.noul, false: 1 - answer.noul } : { ...answer.probabilities };
}

const SEVERITY: Record<FindingKind, number> = { CONFLICT: 4, RESOLVED_CONFLICT: 3, INSUFFICIENT: 2, REVIEW: 1 };

export type DerivedFinding = { readonly finding: Finding; readonly mass: Readonly<Partial<Record<FindingKind, number>>> };

/**
 * The finding for one answer, under the bands of its own question. Mass is the summed probability of the options
 * mapped to each finding kind. The most severe kind whose mass reaches `bands.finding` is the finding; otherwise, if
 * the mass of all mapped options together reaches `bands.review`, it is REVIEW (so mass split across several finding
 * options cannot add up to NO_FINDING); otherwise NO_FINDING. Without bands the result is UNCALIBRATED.
 */
export function deriveFinding(question: Question, answer: Answer, bands: Bands | null): DerivedFinding {
  const probabilities = optionProbabilities(answer);
  const mass: Partial<Record<FindingKind, number>> = {};
  for (const [option, kind] of Object.entries(question.findings) as [string, FindingKind][]) {
    mass[kind] = (mass[kind] ?? 0) + (probabilities[option] ?? 0);
  }
  if (bands === null) return { finding: 'UNCALIBRATED', mass };

  const kinds = (Object.keys(mass) as FindingKind[]).sort((a, b) => SEVERITY[b] - SEVERITY[a]);
  for (const kind of kinds) if ((mass[kind] ?? 0) >= bands.finding) return { finding: kind, mass };
  if (kinds.reduce((total, kind) => total + (mass[kind] ?? 0), 0) >= bands.review) return { finding: 'REVIEW', mass };
  return { finding: 'NO_FINDING', mass };
}

/** The more severe of two findings, for combining repeated calls of one question. */
export function worseFinding(a: Finding, b: Finding): Finding {
  const rank = (f: Finding) => (f === 'NO_FINDING' ? 0 : f === 'UNCALIBRATED' ? 1.5 : SEVERITY[f]);
  return rank(b) > rank(a) ? b : a;
}

/** Exit code of a completed run. An empty run is not NO_FINDING: nothing was audited. */
export function exitCodeFor(findings: readonly Finding[]): number {
  if (findings.length === 0) return EXIT.BLOCKED_PROFILE_OR_RESPONSE_INVALID;
  if (findings.includes('CONFLICT')) return EXIT.GOVERNANCE_CONFLICT_OR_POLICY_FAIL;
  if (findings.some((f) => f !== 'NO_FINDING')) return EXIT.REQUIRES_HUMAN_REVIEW;
  return EXIT.NO_FINDING;
}

export function exitCodeForBlocked(status: BlockedStatus): number {
  return EXIT[status];
}
