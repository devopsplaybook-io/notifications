import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "../OTelContext";
import { AuthGetUserSession } from "../users/Auth";
import {
  PushGetPublicKey,
  PushIsValidEndpoint,
  PushIsValidSubscription,
  PushSubscribe,
  PushUnsubscribe,
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
        return reply.status(403).send({ error: "Access Denied" });
      }
      if (!PushIsValidSubscription(request.body?.subscription)) {
        return reply.status(400).send({ error: "Invalid: subscription" });
      }
      await PushSubscribe(
        OTelRequestSpan(request),
        userSession.userId,
        request.body.subscription,
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
        return reply.status(403).send({ error: "Access Denied" });
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
  }
}
