import { randomUUID } from "node:crypto";
import { db } from "./postgres.js";
import { auditEvents } from "./schema/audit-events.js";

type AuditEventInput = {
  runId: string;
  eventType:
    | "triage_draft_created"
    | "approval_granted"
    | "approval_rejected";
  actorId: string;
  details?: Record<string, unknown>;
};

export async function recordAuditEvent(
  event: AuditEventInput,
) {
  const [eventRecord] = await db
    .insert(auditEvents)
    .values({
      id: randomUUID(),
      runId: event.runId,
      eventType: event.eventType,
      actorId: event.actorId,
      details: event.details ?? {},
    })
    .returning();

  return eventRecord;
}