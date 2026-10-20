import { z } from "zod";

export const intakeSchema = z.object({
  patientId: z.string().min(1),
  symptoms: z.array(z.string().min(1)).min(1),
  scenarioId: z.enum(["demo-001", "demo-002"]),
});

export type IntakeRequest = z.infer<typeof intakeSchema>;