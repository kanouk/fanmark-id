import { cutoverWriteFreezeState } from "./cutover-write-freeze";

/** Stops new application work. In-flight drain and external SQL writers are separate gates. */
export function shouldFreezeRecoveryWrites(selector: string | undefined): boolean {
  return cutoverWriteFreezeState(selector) !== "disabled";
}
