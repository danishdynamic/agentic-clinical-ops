import Fastify from "fastify";
import { intakeRoutes } from "./routes/intake.routes.js";
import { connectRedis } from "./redis/redis.js";
import { checkpointer } from "./ai/checkpointer.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
  },
});

// Register health check endpoint
app.get("/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});


// Register domain routes (using route prefixes keeps routes clean)
await app.register(intakeRoutes, { prefix: "/api/v1" });

await checkpointer.setup();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const start = async () => {
  try {
    await connectRedis();
    await app.listen({ port: PORT, host: HOST });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

// Graceful shutdown handling
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Error during graceful shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();