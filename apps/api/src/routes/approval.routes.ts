import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { recordApproval } from "../db/approvals.js";
import {
  ApprovalAlreadyRecordedError,
  IdempotencyConflictError,
} from "../db/approval-errors.js";
import { resumeTriageWorkflow } from "../ai/resume-triage.js";

const approvalSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewerId: z.string().trim().min(1).max(128),
});

export async function approvalRoutes(app: FastifyInstance) {
  app.post("/api/runs/:runId/approval", async (request, reply) => {
    const paramsSchema = z.object({
      runId: z.string().uuid(),
    });

    const params = paramsSchema.safeParse(request.params);
    const body = approvalSchema.safeParse(request.body);
    const idempotencyKey = request.headers["idempotency-key"];

    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: "Invalid approval request",
        details: {
          params: params.success ? undefined : params.error.flatten(),
          body: body.success ? undefined : body.error.flatten(),
        },
      });
    }

    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.trim().length === 0 ||
      idempotencyKey.length > 200
    ) {
      return reply.status(400).send({
        error: "A valid Idempotency-Key header is required",
      });
    }

    const { runId } = params.data;
    const { decision, reviewerId } = body.data;

    try {
      const recorded = await recordApproval({
        runId,
        decision,
        reviewerId,
        idempotencyKey,
      });

      // An exact replay must not try to resume the workflow again.
      if (recorded.replayed) {
        return reply.status(200).send({
          runId,
          decision: recorded.approval.decision,
          replayed: true,
          status: "decision_recorded",
        });
      }

      const result = await resumeTriageWorkflow(runId);

      return reply.status(200).send({
        runId,
        decision,
        replayed: false,
        status: "completed",
        result,
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return reply.status(409).send({
          error: "Idempotency key conflict",
        });
      }

      if (error instanceof ApprovalAlreadyRecordedError) {
        return reply.status(409).send({
          error: "An approval decision has already been recorded for this run",
        });
      }

      request.log.error(
        { err: error, runId },
        "Approval workflow failed",
      );

      throw error;
    }
  });
}