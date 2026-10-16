import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull(),
  eventType: text("event_type").notNull(),
  actorId: text("actor_id").notNull(),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", {
    withTimezone: true,
  }).notNull().defaultNow(),
});