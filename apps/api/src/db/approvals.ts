import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "./postgres.js";
import { approvals } from "./schema/approvals.js";
import { auditEvents } from "./schema/audit-events.js";
import {
  ApprovalAlreadyRecordedError,
  IdempotencyConflictError,
} from "./approval-errors.js";

export type ApprovalDecision = "approved" | "rejected";

export type RecordApprovalInput = {
  runId: string;
  idempotencyKey: string;
  decision: ApprovalDecision;
  reviewerId: string;
};

export async function recordApproval(
  input: RecordApprovalInput,
) {
  try {
    return await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(approvals)
        .values({
          id: randomUUID(),
          runId: input.runId,
          idempotencyKey: input.idempotencyKey,
          decision: input.decision,
          reviewerId: input.reviewerId,
        })
        .onConflictDoNothing({
          target: approvals.idempotencyKey,
        })
        .returning();

      if (inserted) {
        // Record the audit event inside the same transaction only when a new approval is created
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          runId: input.runId,
          eventType:
            input.decision === "approved"
              ? "approval_granted"
              : "approval_rejected",
          actorId: input.reviewerId,
          details: {
            approvalId: inserted.id,
            decision: input.decision,
          },
        });

        return { approval: inserted, replayed: false };
      }

      const [existing] = await tx
        .select()
        .from(approvals)
        .where(eq(approvals.idempotencyKey, input.idempotencyKey))
        .limit(1);

      if (!existing) {
        throw new Error(
          "Approval conflict occurred, but no existing record was found",
        );
      }

      const sameRequest =
        existing.runId === input.runId &&
        existing.decision === input.decision &&
        existing.reviewerId === input.reviewerId;

      if (!sameRequest) {
        throw new IdempotencyConflictError();
      }

      return { approval: existing, replayed: true };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505" &&
      "constraint" in error &&
      error.constraint === "approvals_run_id_unique"
    ) {
      throw new ApprovalAlreadyRecordedError(input.runId);
    }

    throw error;
  }
}