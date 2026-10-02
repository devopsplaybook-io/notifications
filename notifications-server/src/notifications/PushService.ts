import * as webpush from "web-push";
import { Span } from "@opentelemetry/sdk-trace-base";
import { DbUtilsExecSQL } from "@devopsplaybook.io/common-utils";
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

export async function PushSubscribe(
  context: Span,
  userId: string,
  subscription: Record<string, unknown>,
): Promise<void> {
  const span = OTelTracer().startSpan("PushSubscribe", context);
  try {
    // Atomic upsert: the UNIQUE constraint on endpoint (migration 0005) keeps a
    // single row per endpoint under concurrent subscribes.
    await DbUtilsExecSQL(
      span,
      'INSERT INTO push_subscriptions ("userId", endpoint, subscription) VALUES (?, ?, ?) ' +
        'ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription, "userId" = excluded."userId"',
      [userId, subscription.endpoint, JSON.stringify(subscription)],
    );
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
