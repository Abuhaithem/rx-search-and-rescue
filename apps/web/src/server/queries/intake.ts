import { and, desc, eq } from "drizzle-orm";
import {
  clientMedications,
  clientPharmacies,
  clients,
  getDb,
  inForcePolicies,
  ingestionJobs,
  pharmacies,
} from "@rxsr/db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ClientRow = typeof clients.$inferSelect;
export type ClientMedicationRow = typeof clientMedications.$inferSelect;
export type ClientPharmacyRow = typeof clientPharmacies.$inferSelect;
export type PharmacyRow = typeof pharmacies.$inferSelect;
export type PolicyRow = typeof inForcePolicies.$inferSelect;

export interface IntakeIngestionStatus {
  status: string; // queued | running | done | failed
  error: string | null;
  updatedAt: Date;
}

export interface IntakeData {
  client: ClientRow;
  medications: ClientMedicationRow[];
  pharmacies: (ClientPharmacyRow & { pharmacy: PharmacyRow | null })[];
  policies: PolicyRow[];
  /** Signed URL for the original RxC PDF; null when not uploaded or unavailable. */
  sourcePdfUrl: string | null;
  /** Latest RxC extraction job for this client; drives the reading/failed states. */
  ingestion: IntakeIngestionStatus | null;
}

export async function getIntake(clientId: string): Promise<IntakeData | null> {
  const db = getDb();
  const row = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    with: {
      medications: { orderBy: (m, { asc }) => [asc(m.position)] },
      pharmacies: { with: { pharmacy: true }, orderBy: (p, { asc }) => [asc(p.rank)] },
      policies: true,
    },
  });
  if (!row) return null;

  const { medications, pharmacies: clientPharmacyRows, policies, ...client } = row;

  let sourcePdfUrl: string | null = null;
  if (client.sourceRxcPath) {
    try {
      const supabase = createSupabaseServiceClient();
      const { data } = await supabase.storage
        .from("documents")
        .createSignedUrl(client.sourceRxcPath, 60 * 60);
      sourcePdfUrl = data?.signedUrl ?? null;
    } catch {
      sourcePdfUrl = null;
    }
  }

  const [latestJob] = await db
    .select({
      status: ingestionJobs.status,
      error: ingestionJobs.error,
      updatedAt: ingestionJobs.updatedAt,
    })
    .from(ingestionJobs)
    .where(and(eq(ingestionJobs.kind, "rxc"), eq(ingestionJobs.targetId, clientId)))
    .orderBy(desc(ingestionJobs.createdAt))
    .limit(1);

  return {
    client,
    medications,
    pharmacies: clientPharmacyRows,
    policies,
    sourcePdfUrl,
    ingestion: latestJob ?? null,
  };
}
