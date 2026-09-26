import { FastifyInstance, FastifyRequest, RequestGenericInterface } from "fastify";
import { OTelLogger, OTelRequestSpan } from "../OTelContext";
import {
  NotificationsDataList,
  NotificationsDataAdd,
  NotificationsDataCount,
  NotificationsDataDelete,
  NotificationsDataDeleteAll,
  NotificationsDataSources,
  NotificationsDataUpdateRead,
  NotificationsDataUpdateReadAll,
  NotificationReadFilter,
} from "./NotificationsData";
import { AuthGetUserSession } from "../users/Auth";
import { ApiTokensValidate } from "../apitokens/ApiTokensData";
import { Notification } from "../model/Notification";
import { PushSendToAll } from "./PushService";

const logger = OTelLogger().createModuleLogger("NotificationsRoutes");
const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

function getBearerToken(header: string | undefined): string | undefined {
  return header?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

function parsePagination(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^-?\d+$/.test(value)) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function NormalizeNotificationData(data: unknown): string | undefined {
  if (data === undefined) {
    return "{}";
  }
  let value: unknown = data;
  if (typeof data === "string") {
    try {
      value = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return JSON.stringify(value);
}

/**
 * Accept the request when it carries a valid API token (Authorization: Bearer).
 * Used as a fallback on read-only routes, which stay open to both user
 * sessions and API tokens.
 */
async function IsApiTokenAuthorized(req: FastifyRequest): Promise<boolean> {
  const token = getBearerToken(req.headers.authorization);
  if (!token) return false;
  return ApiTokensValidate(OTelRequestSpan(req), token);
}

export class NotificationsRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // List notifications (requires user session or API token)
    interface GetNotifications extends RequestGenericInterface {
      Querystring: {
        limit?: string;
        offset?: string;
        source?: string;
        read?: string;
      };
    }
    fastify.get<GetNotifications>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated && !(await IsApiTokenAuthorized(req))) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const limit = Math.min(
        200,
        Math.max(1, parsePagination(req.query.limit, 50)),
      );
      const offset = Math.max(0, parsePagination(req.query.offset, 0));
      const source = req.query.source || "";
      const read: NotificationReadFilter =
        req.query.read === "unread" || req.query.read === "read"
          ? req.query.read
          : "all";
      const notifications = await NotificationsDataList(
        OTelRequestSpan(req),
        limit,
        offset,
        source,
        read,
      );
      const total = await NotificationsDataCount(
        OTelRequestSpan(req),
        source,
        read,
      );
      return res.status(200).send({ notifications, total });
    });

    // List distinct notification sources (requires user session or API token)
    fastify.get("/sources", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated && !(await IsApiTokenAuthorized(req))) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const sources = await NotificationsDataSources(OTelRequestSpan(req));
      return res.status(200).send({ sources });
    });

    // Create notification via API (requires API token)
    interface PostNotification extends RequestGenericInterface {
      Body: {
        title?: unknown;
        body?: unknown;
        source?: unknown;
        severity?: unknown;
        data?: unknown;
      };
    }
    fastify.post<PostNotification>("/", async (req, res) => {
      // Validate API token from Authorization header
      const token = getBearerToken(req.headers.authorization);
      if (!token) {
        return res.status(401).send({ error: "Missing API token" });
      }
      const isValid = await ApiTokensValidate(OTelRequestSpan(req), token);
      if (!isValid) {
        return res.status(403).send({ error: "Invalid API token" });
      }

      const body = req.body;
      const title = body?.title;
      if (
        typeof title !== "string" ||
        title.trim() === "" ||
        title.length > 1000
      ) {
        return res.status(400).send({ error: "Invalid: title" });
      }
      const textBody = body.body === undefined ? "" : body.body;
      if (typeof textBody !== "string") {
        return res.status(400).send({ error: "Invalid: body" });
      }
      const source = body.source === undefined ? "api" : body.source;
      if (
        typeof source !== "string" ||
        source.trim() === "" ||
        source.length > 200
      ) {
        return res.status(400).send({ error: "Invalid: source" });
      }
      const severity = body.severity === undefined ? "info" : body.severity;
      if (
        typeof severity !== "string" ||
        severity.trim() === "" ||
        severity.length > 20
      ) {
        return res.status(400).send({ error: "Invalid: severity" });
      }
      const data = NormalizeNotificationData(body.data);
      if (data === undefined) {
        return res.status(400).send({ error: "Invalid: data must be a JSON object" });
      }

      const notification = new Notification();
      notification.title = title;
      notification.body = textBody;
      notification.source = source;
      notification.severity = severity;
      notification.data = data;

      const created = await NotificationsDataAdd(
        OTelRequestSpan(req),
        notification,
      );

      // Send push notifications to all subscribed users
      try {
        await PushSendToAll(created);
      } catch (error) {
        // Push failure should not fail the API response
        logger.error(
          "Push notification fan-out failed",
          toError(error),
          OTelRequestSpan(req),
        );
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
      const deleted = await NotificationsDataDelete(
        OTelRequestSpan(req),
        req.params.id,
      );
      if (!deleted) {
        return res.status(404).send({ error: "Notification not found" });
      }
      return res.status(200).send({ success: true });
    });

    // Update the read state of a notification (requires user auth)
    interface PutNotificationRead extends RequestGenericInterface {
      Params: {
        id: string;
      };
      Body: {
        read: boolean;
      };
    }
    fastify.put<PutNotificationRead>("/:id/read", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (typeof req.body.read !== "boolean") {
        return res.status(400).send({ error: "Missing: read" });
      }
      const updated = await NotificationsDataUpdateRead(
        OTelRequestSpan(req),
        req.params.id,
        req.body.read,
      );
      if (!updated) {
        return res.status(404).send({ error: "Notification not found" });
      }
      return res.status(200).send({ success: true });
    });

    // Mark all notifications matching the filters as read (requires user auth)
    interface PutNotificationsReadAll extends RequestGenericInterface {
      Querystring: {
        source?: string;
        read?: string;
      };
    }
    fastify.put<PutNotificationsReadAll>("/read-all", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const source = req.query.source || "";
      const read: NotificationReadFilter =
        req.query.read === "unread" || req.query.read === "read"
          ? req.query.read
          : "all";
      const updated = await NotificationsDataUpdateReadAll(
        OTelRequestSpan(req),
        source,
        read,
      );
      return res.status(200).send({ success: true, updated });
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
