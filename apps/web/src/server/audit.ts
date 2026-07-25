import { auditEvents, type Db } from "@rxsr/db";

type DbExecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface AuditInput {
  actorId: string | null;
  action: string; // "analysis.approved", "formulary.activated", …
  entityType: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}

export async function writeAudit(executor: DbExecutor, event: AuditInput): Promise<void> {
  await executor.insert(auditEvents).values({
    actorId: event.actorId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    meta: event.meta,
  });
}
