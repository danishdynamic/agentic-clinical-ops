CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
