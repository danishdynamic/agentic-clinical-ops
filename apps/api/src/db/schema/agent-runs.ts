import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type AgentRunStatus =
  | "running"
  | "awaiting_approval"
  | "resuming"
  | "completed"
  | "failed";

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey(),

  patientId: text("patient_id").notNull(),

  status: text("status")
    .$type<AgentRunStatus>()
    .notNull(),

  startedAt: timestamp("started_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),

  completedAt: timestamp("completed_at", {
    withTimezone: true,
  }),
});
