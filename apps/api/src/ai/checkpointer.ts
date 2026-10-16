import { env } from "../config/env.js";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

export const checkpointer = PostgresSaver.fromConnString(
  env.databaseUrl,
);

// Automatically provision the checkpointer tables if they don't exist
await checkpointer.setup();