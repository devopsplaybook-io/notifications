import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "../OTelContext";
import {
  NotificationsDataList,
  NotificationsDataAdd,
  NotificationsDataCount,
  NotificationsDataDelete,
  NotificationsDataDeleteAll,
  NotificationsDataSources,
} from "./NotificationsData";
import { AuthGetUserSession } from "../users/Auth";
import { ApiTokensValidate } from "../apitokens/ApiTokensData";
import { Notification } from "../model/Notification";
import { PushSendToAll } from "./PushService";

export class NotificationsRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // List notifications (requires user auth)
    interface GetNotifications extends RequestGenericInterface {
      Querystring: {
        limit?: string;
        offset?: string;
        source?: string;
      };
    }
    fastify.get<GetNotifications>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const source = req.query.source || "";
      const notifications = await NotificationsDataList(
        OTelRequestSpan(req),
        limit,
        offset,
        source,
      );
      const total = await NotificationsDataCount(OTelRequestSpan(req), source);
      return res.status(200).send({ notifications, total });
    });

    // List distinct notification sources (requires user auth)
    fastify.get("/sources", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const sources = await NotificationsDataSources(OTelRequestSpan(req));
      return res.status(200).send({ sources });
    });

    // Create notification via API (requires API token)
    interface PostNotification extends RequestGenericInterface {
      Body: {
        title: string;
        body: string;
        source?: string;
        severity?: string;
        data?: string;
      };
    }
    fastify.post<PostNotification>("/", async (req, res) => {
      // Validate API token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ error: "Missing API token" });
      }
      const token = authHeader.replace("Bearer ", "");
      const isValid = await ApiTokensValidate(OTelRequestSpan(req), token);
      if (!isValid) {
        return res.status(403).send({ error: "Invalid API token" });
      }

      if (!req.body.title) {
        return res.status(400).send({ error: "Missing: title" });
      }

      const notification = new Notification();
      notification.title = req.body.title;
      notification.body = req.body.body || "";
      notification.source = req.body.source || "api";
      notification.severity = req.body.severity || "info";
      notification.data = req.body.data ? JSON.stringify(req.body.data) : "{}";

      const created = await NotificationsDataAdd(
        OTelRequestSpan(req),
        notification,
      );

      // Send push notifications to all subscribed users
      try {
        await PushSendToAll(created);
      } catch (err) {
        // Push failure should not fail the API response
        console.error("Push notification failed:", err);
      }

      return res.status(201).send(created);
    });

    // Delete a single notification (requires user auth)
    interface DeleteNotification extends RequestGenericInterface {
      Params: {
        id: string;
      };
    }
    fastify.delete<DeleteNotification>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      await NotificationsDataDelete(OTelRequestSpan(req), req.params.id);
      return res.status(200).send({ success: true });
    });

    // Delete all notifications (requires user auth)
    fastify.delete("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const count = await NotificationsDataDeleteAll(OTelRequestSpan(req));
      return res.status(200).send({ success: true, deleted: count });
    });
  }
}
