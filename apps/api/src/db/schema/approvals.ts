import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { agentRuns } from "./agent-runs.js";

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey(),

    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id),

    idempotencyKey: text("idempotency_key").notNull(),

    decision: text("decision")
      .$type<"approved" | "rejected">()
      .notNull(),

    reviewerId: text("reviewer_id").notNull(),

    decidedAt: timestamp("decided_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("approvals_idempotency_key_unique")
      .on(table.idempotencyKey),

    unique("approvals_run_id_unique")
      .on(table.runId),
  ],
);