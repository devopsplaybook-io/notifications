import * as webpush from "web-push";
import { createHash } from "crypto";
import { Span } from "@opentelemetry/sdk-trace-base";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import { OTelTracer } from "../OTelContext";
import { Config } from "../Config";
import { Notification } from "../model/Notification";
import { PushQueueEnqueue } from "../push/PushQueue";

let config: Config;

export function PushIsValidSubscription(
  subscription: unknown,
): subscription is Record<string, unknown> {
  if (!subscription || typeof subscription !== "object") {
    return false;
  }
  const candidate = subscription as Record<string, unknown>;
  if (!PushIsValidEndpoint(candidate.endpoint)) {
    return false;
  }
  try {
    const keys = candidate.keys;
    return (
      !!keys &&
      typeof keys === "object" &&
      typeof (keys as Record<string, unknown>).p256dh === "string" &&
      (keys as Record<string, string>).p256dh.length <= 256 &&
      (keys as Record<string, unknown>).p256dh !== "" &&
      typeof (keys as Record<string, unknown>).auth === "string" &&
      (keys as Record<string, string>).auth.length <= 128 &&
      (keys as Record<string, unknown>).auth !== ""
    );
  } catch {
    return false;
  }
}

export function PushIsValidEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2000) {
    return false;
  }
  try {
    const parsed = new URL(endpoint);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      parsed.hostname !== ""
    );
  } catch {
    return false;
  }
}

export function PushInit(configIn: Config) {
  config = configIn;
  if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      config.VAPID_SUBJECT || "mailto:notifications@devopsplaybook.io",
      config.VAPID_PUBLIC_KEY,
      config.VAPID_PRIVATE_KEY,
    );
  }
}

export function PushGetPublicKey(): string {
  return config?.VAPID_PUBLIC_KEY || "";
}

/** Push subscription as exposed to the session owner. The full endpoint
 * (which contains capability tokens) is never returned, only its origin and
 * a hash used by the browser to recognize its own subscription. */
export interface PushSubscriptionEntry {
  id: string;
  endpointOrigin: string;
  userAgent: string;
  createdAt: string;
  endpointHash: string;
}

const MAX_USER_AGENT_LENGTH = 500;

export function PushNormalizeUserAgent(userAgent: unknown): string {
  if (typeof userAgent !== "string") {
    return "";
  }
  return userAgent.slice(0, MAX_USER_AGENT_LENGTH);
}

export function PushEndpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

function PushEndpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return "";
  }
}

export async function PushSubscribe(
  context: Span,
  userId: string,
  subscription: Record<string, unknown>,
  userAgent: string,
): Promise<void> {
  const span = OTelTracer().startSpan("PushSubscribe", context);
  try {
    // Atomic upsert: the UNIQUE constraint on endpoint (migration 0005) keeps a
    // single row per endpoint under concurrent subscribes. createdAt keeps the
    // first-seen value on conflict; subscription, userId and userAgent refresh.
    await DbUtilsExecSQL(
      span,
      'INSERT INTO push_subscriptions ("userId", endpoint, subscription, userAgent, createdAt) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription, "userId" = excluded."userId", userAgent = excluded.userAgent',
      [
        userId,
        subscription.endpoint,
        JSON.stringify(subscription),
        userAgent,
        new Date().toISOString(),
      ],
    );
  } finally {
    span.end();
  }
}

export async function PushListSubscriptions(
  context: Span,
  userId: string,
): Promise<PushSubscriptionEntry[]> {
  const span = OTelTracer().startSpan("PushListSubscriptions", context);
  try {
    const rows = await DbUtilsQuerySQL(
      span,
      'SELECT id, endpoint, userAgent, createdAt FROM push_subscriptions WHERE "userId" = ? ORDER BY "createdAt" DESC',
      [userId],
    );
    return rows.map((row) => ({
      id: row.id,
      endpointOrigin: PushEndpointOrigin(row.endpoint),
      userAgent: row.userAgent,
      createdAt: row.createdAt,
      endpointHash: PushEndpointHash(row.endpoint),
    }));
  } finally {
    span.end();
  }
}

export async function PushUnsubscribe(
  context: Span,
  endpoint: string,
): Promise<void> {
  const span = OTelTracer().startSpan("PushUnsubscribe", context);
  try {
    await DbUtilsExecSQL(
      span,
      "DELETE FROM push_subscriptions WHERE endpoint = ?",
      [endpoint],
    );
  } finally {
    span.end();
  }
}

export async function PushUnsubscribeById(
  context: Span,
  userId: string,
  id: string,
): Promise<boolean> {
  const span = OTelTracer().startSpan("PushUnsubscribeById", context);
  try {
    const changes = await DbUtilsExecSQL(
      span,
      'DELETE FROM push_subscriptions WHERE id = ? AND "userId" = ?',
      [id, userId],
    );
    return changes > 0;
  } finally {
    span.end();
  }
}

/**
 * Enqueue a push fan-out for background delivery. The notification is queued
 * immediately (sub-millisecond) and delivered by the PushQueue worker with
 * retries; the API request does not wait for push services.
 */
export async function PushSendToAll(notification: Notification): Promise<void> {
  if (!config?.VAPID_PUBLIC_KEY || !config?.VAPID_PRIVATE_KEY) {
    return;
  }
  PushQueueEnqueue(notification);
}
