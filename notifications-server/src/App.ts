import { StandardMeter, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { DbUtilsSetOTel, DbUtilsInit } from "@devopsplaybook.io/common-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { RequestGenericInterface } from "fastify";
import { watchFile } from "fs-extra";
import * as path from "path";
import { Config } from "./Config";
import {
  OTelLogger,
  OTelRequestSpan,
  OTelSetMeter,
  OTelSetTracer,
  OTelTracer,
} from "./OTelContext";
import { AuthGetUserSession, AuthInit } from "./users/Auth";
import { UsersRoutes } from "./users/UsersRoutes";
import { NotificationsRoutes } from "./notifications/NotificationsRoutes";
import { ApiTokensRoutes } from "./apitokens/ApiTokensRoutes";
import { PushInit, PushGetPublicKey, PushSubscribe } from "./notifications/PushService";

const logger = OTelLogger().createModuleLogger("app");

logger.info("====== Starting Notifications Server ======");

Promise.resolve().then(async () => {
  const config = new Config();
  await config.reload((msg) => logger.info(msg));
  watchFile(config.CONFIG_FILE, () => {
    logger.info(`Config updated: ${config.CONFIG_FILE}`);
    config.reload((msg) => logger.info(msg));
  });

  OTelSetTracer(new StandardTracer(config));
  OTelSetMeter(new StandardMeter(config));
  OTelLogger().initOTel(config);

  DbUtilsSetOTel(OTelTracer(), OTelLogger());

  const span = OTelTracer().startSpan("init");

  await DbUtilsInit(span, config, `${__dirname}/../sql`);
  await AuthInit(span, config);
  PushInit(config);

  span.end();

  // API

  const fastify = Fastify({});

  if (config.CORS_POLICY_ORIGIN) {
    fastify.register(cors, {
      origin: config.CORS_POLICY_ORIGIN,
      methods: "GET,PUT,POST,DELETE",
    });
  }

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

  // VAPID public key endpoint (for PWA push)
  fastify.get("/api/push/publickey", async (_req, res) => {
    return res.status(200).send({ publicKey: PushGetPublicKey() });
  });

  // Push subscription endpoint
  interface PostPushSubscribe extends RequestGenericInterface {
    Body: {
      subscription: Record<string, unknown>;
    };
  }
  fastify.post<PostPushSubscribe>("/api/push/subscribe", async (req, res) => {
    const userSession = await AuthGetUserSession(req);
    if (!userSession.isAuthenticated) {
      return res.status(403).send({ error: "Access Denied" });
    }
    if (!req.body.subscription) {
      return res.status(400).send({ error: "Missing: subscription" });
    }
    await PushSubscribe(OTelRequestSpan(req), userSession.userId, req.body.subscription);
    return res.status(201).send({ success: true });
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

  fastify.listen({ port: config.API_PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
      logger.error("Error Starting API", err);
      process.exit(1);
    }
    logger.info("API Listening");
  });
});
