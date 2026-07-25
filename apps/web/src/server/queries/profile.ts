import { getSessionProfile, type SessionProfile } from "../auth";

export type { SessionProfile };

export async function getProfile(): Promise<SessionProfile | null> {
  return getSessionProfile();
}
