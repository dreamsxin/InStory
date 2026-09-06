/**
 * What a form knows after it was submitted. Lives here rather than beside the
 * actions because a "use server" module may only export async functions, so the
 * shared idle value cannot sit next to the actions that return it.
 */
export interface FormResult {
  status: "idle" | "ok" | "error";
  message: string;
  /**
   * What was submitted, handed back so a failed create can re-fill its fields.
   * Next re-renders the form after an action, and uncontrolled inputs come back
   * empty, so without this a rejected story took four sections of typing with it.
   */
  values?: Record<string, string>;
}

export const IDLE_FORM: FormResult = { status: "idle", message: "" };

/** Reads a submitted single value back out of a failed result. */
export function submitted(result: FormResult, field: string): string {
  return result.values?.[field] ?? "";
}
