export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });

export const err = <T = never>(error: string): ActionResult<T> => ({ ok: false, error });

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : "Something went wrong";
