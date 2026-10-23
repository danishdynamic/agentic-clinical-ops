import { env } from "../config/env.js";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

export const checkpointer = PostgresSaver.fromConnString(
  env.databaseUrl,
);