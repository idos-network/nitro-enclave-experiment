/** True when `fn` returns without throwing; for "does this input parse" refinements. */
export function compiles(fn: () => unknown): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}
