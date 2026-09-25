# Local KoSIT validation harness

Development and testing only. It needs Java 11+, the `unzip` command and the official XRechnung bundle. None of
these is part of the repository or of `npm test`, and nothing here is a server or a browser feature.

```
ORKAID_KOSIT_BUNDLE=/path/to/xrechnung-3.0.2-bundle-2026-08-31.zip npm run test:kosit
npm run test:kosit -- a-simple     # one fixture; the negative control is control-missing-buyer-reference
```

What it does, in order:

1. Verifies the SHA-256 of the bundle, the validator jar and the validator configuration against
   `kosit-manifest.json` and stops on any mismatch. The bundle location comes only from the environment.
2. Extracts the validator and configuration into the git-ignored `.cache/kosit/`.
3. Checks that every code in `UNIT_CODES` is in the validator configuration's own unit-code list.
4. Regenerates each fixture's XML in-process and requires it to equal the committed golden file byte for byte.
5. Runs the validator on that exact file and reads its XML report.
6. Writes one evidence record per document to `.cache/kosit/evidence/<name>.json` (fixture and XML hashes, versions,
   Java version, matched scenario, per-step results, every message with identifier and severity, `valid`,
   assessment, process exit code, raw stdout and stderr). These records are scratch output and are not committed.

The process exit code, the report's `valid` field, the message severities and the assessment are separate results
and are recorded separately. A document passes only if the intended scenario was matched, every validation step is
valid, the validator hashed the same bytes that were generated, the assessment is `accept`, and every message is
explicitly triaged in `tests/fixtures/xrechnung/kosit-triage.json` (an understood information-level message is
allowed; a warning or error is a failure). Exit code 0 alone is never sufficient.

The control document (a golden copy without BT-10) must be rejected, which shows that the harness does not accept
every document. A pass is not legal certification and says nothing about tax correctness or recipient acceptance.
