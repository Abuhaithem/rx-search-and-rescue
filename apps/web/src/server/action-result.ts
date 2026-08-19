import { ZodError } from "zod";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });

export const err = <T = never>(error: string): ActionResult<T> => ({ ok: false, error });

export const errorMessage = (e: unknown): string => {
  // ZodError.message is a raw JSON dump of the issues — never show that.
  if (e instanceof ZodError) {
    const issue = e.issues[0];
    if (!issue) return "Invalid input";
    const path = issue.path.join(".");
    const detail = issue.message === "Invalid" ? "invalid value" : issue.message;
    return path ? `${path}: ${detail}` : detail;
  }
  return e instanceof Error ? e.message : "Something went wrong";
};
