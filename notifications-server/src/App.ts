import { StandardMeter, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  DbUtilsGetDatabase,
  DbUtilsSetOTel,
  DbUtilsInit,
} from "@devopsplaybook.io/common-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { watchFile } from "fs-extra";
import { rename } from "fs/promises";
import * as path from "path";
import { Config } from "./Config";
import {
  OTelLogger,
  OTelRequestSpan,
  OTelSetMeter,
  OTelSetTracer,
  OTelTracer,
} from "./OTelContext";
import {
  AuthInit,
  AuthRenewSession,
  AuthValidateJWTKey,
} from "./users/Auth";
import { UsersRoutes } from "./users/UsersRoutes";
import { NotificationsRoutes } from "./notifications/NotificationsRoutes";
import { ApiTokensRoutes } from "./apitokens/ApiTokensRoutes";
import { ApiTokensMigrateToHashed } from "./apitokens/ApiTokensData";
import { PushInit } from "./notifications/PushService";
import { PushRoutes } from "./notifications/PushRoutes";
import { NotificationsDataPrune } from "./notifications/NotificationsData";

const logger = OTelLogger().createModuleLogger("app");
const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

logger.info("====== Starting Notifications Server ======");

Promise.resolve().then(async () => {
  const config = new Config();
  await config.reload((msg) => logger.info(msg));
  AuthValidateJWTKey(config.JWT_KEY);
  if (
    !Number.isInteger(config.NOTIFICATION_RETENTION_DAYS) ||
    config.NOTIFICATION_RETENTION_DAYS < 0
  ) {
    throw new Error("NOTIFICATION_RETENTION_DAYS must be a non-negative integer");
  }
  watchFile(config.CONFIG_FILE, () => {
    logger.info(`Config updated: ${config.CONFIG_FILE}`);
    config.reload((msg) => logger.info(msg));
  });

  OTelSetTracer(new StandardTracer(config));
  OTelSetMeter(new StandardMeter(config));
  OTelLogger().initOTel(config);

  DbUtilsSetOTel(OTelTracer(), OTelLogger());

  const span = OTelTracer().startSpan("init");

  await DbUtilsInit(
    span,
    config,
    path.join(__dirname, `../sql/${config.DATABASE_TYPE}`),
  );
  if (config.DATABASE_TYPE === "sqlite") {
    DbUtilsGetDatabase().pragma("busy_timeout = 5000");
  }
  await AuthInit(span, config);
  await ApiTokensMigrateToHashed(span);
  PushInit(config);

  span.end();

  const pruneNotifications = async (): Promise<void> => {
    if (config.NOTIFICATION_RETENTION_DAYS === 0) return;
    const cutoff = new Date(
      Date.now() - config.NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const pruneSpan = OTelTracer().startSpan("notifications.retention");
    try {
      await NotificationsDataPrune(pruneSpan, cutoff);
    } catch (error) {
      logger.error("Notification retention pruning failed", toError(error));
    } finally {
      pruneSpan.end();
    }
  };

  const createSQLiteBackup = async (): Promise<void> => {
    if (config.DATABASE_TYPE !== "sqlite") return;
    const temporaryPath = path.join(config.DATA_DIR, "database.db.backup.tmp");
    const backupPath = path.join(config.DATA_DIR, "database.db.backup");
    try {
      await DbUtilsGetDatabase().backup(temporaryPath);
      await rename(temporaryPath, backupPath);
      logger.info(`SQLite online backup updated: ${backupPath}`);
    } catch (error) {
      logger.error("SQLite online backup failed", toError(error));
    }
  };

  await pruneNotifications();
  await createSQLiteBackup();
  const retentionTimer = setInterval(
    () => void pruneNotifications(),
    24 * 60 * 60 * 1000,
  );
  const backupTimer = setInterval(
    () => void createSQLiteBackup(),
    6 * 60 * 60 * 1000,
  );

  // API

  const fastify = Fastify({ bodyLimit: 1024 * 1024 });

  fastify.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  });

  fastify.setErrorHandler(
    (error: Error & { statusCode?: number }, request, reply) => {
      if (error.statusCode && error.statusCode < 500) {
        return reply
          .status(error.statusCode)
          .send({ error: error.message || "Bad Request" });
      }
      logger.error("Unhandled API error", error, OTelRequestSpan(request));
      return reply.status(500).send({ error: "Internal Server Error" });
    },
  );

  if (config.CORS_POLICY_ORIGIN) {
    fastify.register(cors, {
      origin: config.CORS_POLICY_ORIGIN,
      methods: "GET,PUT,POST,DELETE",
      exposedHeaders: ["X-Renewed-Token"],
    });
  }

  // Sliding session: renew tokens older than 24h on any authenticated request
  fastify.addHook("onSend", async (req, res) => {
    await AuthRenewSession(req, res);
  });

  StandardTracerFastifyRegisterHooks(fastify, OTelTracer(), OTelLogger(), {
    ignoreList: ["GET-/api/status"],
  });

  fastify.register(new UsersRoutes().getRoutes, {
    prefix: "/api/users",
  });
  fastify.register(new NotificationsRoutes().getRoutes, {
    prefix: "/api/notifications",
  });
  fastify.register(new ApiTokensRoutes().getRoutes, {
    prefix: "/api/tokens",
  });
  fastify.register(new PushRoutes().getRoutes, {
    prefix: "/api/push",
  });

  fastify.get("/api/status", async () => {
    return { started: true };
  });

  fastify.register(fastifyStatic, {
    root: path.join(__dirname, "../web"),
    prefix: "/",
    wildcard: false,
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (
      request.raw.url &&
      !request.raw.url.startsWith("/api/") &&
      !path.extname(request.raw.url)
    ) {
      return reply.sendFile("index.html");
    }
    reply.status(404).send({ error: "Not Found" });
  });

  await fastify.listen({ port: config.API_PORT, host: "0.0.0.0" });
  logger.info("API Listening");

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(retentionTimer);
    clearInterval(backupTimer);
    try {
      await fastify.close();
      const database = DbUtilsGetDatabase();
      if (config.DATABASE_TYPE === "sqlite") {
        database.close();
      } else {
        await database.end();
      }
    } catch (error) {
      logger.error("Graceful shutdown failed", toError(error));
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
});
