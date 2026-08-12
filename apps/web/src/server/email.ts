/**
 * Transactional email via AWS SES (server only). Same credential chain as
 * S3: instance role in production, env/SSO locally. SES_FROM_ADDRESS must be
 * a verified SES identity; unset = email features are off and senders throw.
 */
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

function getClient(): SESv2Client {
  const g = globalThis as typeof globalThis & { __rxsrSes?: SESv2Client };
  g.__rxsrSes ??= new SESv2Client({});
  return g.__rxsrSes;
}

export function isEmailEnabled(): boolean {
  return Boolean(process.env.SES_FROM_ADDRESS);
}

/**
 * Public origin for links in emails: APP_BASE_URL when set, otherwise
 * derived from SITE_ADDRESS (the Caddy hostname the deploy already knows).
 */
export function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const siteAddress = process.env.SITE_ADDRESS;
  if (siteAddress && siteAddress !== "localhost") return `https://${siteAddress}`;
  return "http://localhost:3000";
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  textBody: string;
}): Promise<void> {
  const from = process.env.SES_FROM_ADDRESS;
  if (!from) throw new Error("SES_FROM_ADDRESS is not set");
  await getClient().send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [input.to] },
      Content: {
        Simple: {
          Subject: { Data: input.subject, Charset: "UTF-8" },
          Body: { Text: { Data: input.textBody, Charset: "UTF-8" } },
        },
      },
    }),
  );
}
