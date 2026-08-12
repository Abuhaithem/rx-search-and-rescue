/**
 * Cloudflare Turnstile verification (server only). The one sanctioned
 * external call in apps/web besides AWS: a CAPTCHA must be verified
 * synchronously inside the auth action itself, so it cannot live in the
 * worker. Both keys unset = feature off (dev sandboxes, tests); the login
 * page hides the widget and verification passes.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileSiteKey(): string | null {
  return process.env.TURNSTILE_SITE_KEY || null;
}

export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstileToken(token: string | null | undefined): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    // Cloudflare unreachable → fail closed: a bot-check that silently
    // passes on outage would defeat its purpose.
    return false;
  }
}
