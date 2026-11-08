// Where focus goes when the help drawer closes. The trigger that opened it can be gone by then: a layout change may close the
// inline help (removing its "more" button) or hide the header help button while the drawer is open. The caller lists the
// candidates in preference order (the trigger first, then the field in the same context); the first usable one wins.

/** The first candidate that exists and passes `usable` (connected and visible); undefined when none does. */
export function returnTarget<T>(candidates: ReadonlyArray<T | null | undefined>, usable: (candidate: T) => boolean): T | undefined {
  for (const candidate of candidates) if (candidate != null && usable(candidate)) return candidate;
  return undefined;
}
