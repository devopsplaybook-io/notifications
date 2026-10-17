import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "../OTelContext";
import { AuthGetUserSession } from "../users/Auth";
import {
  PushGetPublicKey,
  PushIsValidEndpoint,
  PushIsValidSubscription,
  PushListSubscriptions,
  PushNormalizeUserAgent,
  PushSubscribe,
  PushUnsubscribe,
  PushUnsubscribeById,
} from "./PushService";

export class PushRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get("/publickey", async (_request, reply) =>
      reply.status(200).send({ publicKey: PushGetPublicKey() }),
    );

    interface PostPushSubscribe extends RequestGenericInterface {
      Body: {
        subscription?: unknown;
      };
    }
    fastify.post<PostPushSubscribe>("/subscribe", async (request, reply) => {
      const userSession = await AuthGetUserSession(request);
      if (!userSession.isAuthenticated) {
        return reply.status(401).send({ error: "Access Denied" });
      }
      if (!PushIsValidSubscription(request.body?.subscription)) {
        return reply.status(400).send({ error: "Invalid: subscription" });
      }
      await PushSubscribe(
        OTelRequestSpan(request),
        userSession.userId,
        request.body.subscription,
        PushNormalizeUserAgent(request.headers["user-agent"]),
      );
      return reply.status(201).send({ success: true });
    });

    interface DeletePushSubscribe extends RequestGenericInterface {
      Body: {
        endpoint?: unknown;
      };
    }
    fastify.delete<DeletePushSubscribe>("/subscribe", async (request, reply) => {
      const userSession = await AuthGetUserSession(request);
      if (!userSession.isAuthenticated) {
        return reply.status(401).send({ error: "Access Denied" });
      }
      if (!PushIsValidEndpoint(request.body?.endpoint)) {
        return reply.status(400).send({ error: "Invalid: endpoint" });
      }
      await PushUnsubscribe(
        OTelRequestSpan(request),
        request.body.endpoint,
      );
      return reply.status(200).send({ success: true });
    });

    // List the push devices of the current session only: the response holds
    // origin, user agent, subscribe date and an endpoint hash (never the full
    // endpoint, which contains capability tokens).
    fastify.get("/subscriptions", async (request, reply) => {
      const userSession = await AuthGetUserSession(request);
      if (!userSession.isAuthenticated) {
        return reply.status(401).send({ error: "Access Denied" });
      }
      const subscriptions = await PushListSubscriptions(
        OTelRequestSpan(request),
        userSession.userId,
      );
      return reply.status(200).send({ subscriptions });
    });

    // Revoke a push device by id; unknown or not-owned ids return 404.
    interface DeletePushSubscription extends RequestGenericInterface {
      Params: {
        id: string;
      };
    }
    fastify.delete<DeletePushSubscription>(
      "/subscriptions/:id",
      async (request, reply) => {
        const userSession = await AuthGetUserSession(request);
        if (!userSession.isAuthenticated) {
          return reply.status(401).send({ error: "Access Denied" });
        }
        const deleted = await PushUnsubscribeById(
          OTelRequestSpan(request),
          userSession.userId,
          request.params.id,
        );
        if (!deleted) {
          return reply
            .status(404)
            .send({ error: "Push subscription not found" });
        }
        return reply.status(200).send({ success: true });
      },
    );
  }
}
