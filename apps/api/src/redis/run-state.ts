import { redis } from "./redis.js";

export type RunState = {
  status: string;
  currentStep: string;
};

export async function setRunState(
  runId: string,
  state: RunState,
) {
  await redis.set(
    `run:${runId}:state`,
    JSON.stringify(state),
  );
}

export async function getRunState(
  runId: string,
): Promise<RunState | null> {
  const value = await redis.get(
    `run:${runId}:state`,
  );

  if (!value) {
    return null;
  }

  return JSON.parse(value) as RunState;
}