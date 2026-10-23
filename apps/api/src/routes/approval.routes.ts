import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { recordApproval } from "../db/approvals.js";
import {
  ApprovalAlreadyRecordedError,
  IdempotencyConflictError,
} from "../db/approval-errors.js";
import { resumeTriageWorkflow } from "../ai/resume-triage.js";
import { authenticateReviewer, ReviewerAuthConfigurationError } from "../auth/reviewer-auth.js";
import { env } from "../config/env.js";
import { db } from "../db/postgres.js";
import { agentRuns } from "../db/schema/agent-runs.js";

const approvalSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

type ApprovalRouteOptions = {
  authenticate?: typeof authenticateReviewer;
};

export async function approvalRoutes(
  app: FastifyInstance,
  options: ApprovalRouteOptions = {},
) {
  const authenticate = options.authenticate ?? authenticateReviewer;

  app.post("/api/runs/:runId/approval", async (request, reply) => {
    let identity;
    try {
      identity = await authenticate(
        typeof request.headers.authorization === "string"
          ? request.headers.authorization
          : undefined,
      );
    } catch (error) {
      if (error instanceof ReviewerAuthConfigurationError) {
        request.log.error({ err: error }, "Reviewer authentication is not configured");
        return reply.status(503).send({
          error: "Reviewer authentication is unavailable",
        });
      }
      throw error;
    }

    if (!identity) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    if (!identity.roles.includes(env.reviewerRole)) {
      return reply.status(403).send({ error: "Reviewer authorization required" });
    }

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
    const { decision } = body.data;

    const resumeAndRespond = async (replayed: boolean) => {
      const result = await resumeTriageWorkflow(runId);
      return reply.status(200).send({
        runId,
        decision,
        replayed,
        status: "completed",
        result,
      });
    };

    try {
      const recorded = await recordApproval({
        runId,
        decision,
        reviewerId: identity.reviewerId,
        idempotencyKey,
      });

      if (recorded.replayed) {
        const [run] = await db
          .select({ status: agentRuns.status })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId))
          .limit(1);

        if (run?.status === "failed") {
          return await resumeAndRespond(true);
        }

        if (run?.status === "resuming") {
          return reply.status(202).send({
            runId,
            decision: recorded.approval.decision,
            replayed: true,
            status: "resuming",
          });
        }

        return reply.status(200).send({
          runId,
          decision: recorded.approval.decision,
          replayed: true,
          status: "decision_recorded",
        });
      }

      return await resumeAndRespond(false);
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