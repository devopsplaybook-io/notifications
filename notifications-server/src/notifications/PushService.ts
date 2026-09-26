import * as webpush from "web-push";
import { Span } from "@opentelemetry/sdk-trace-base";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import * as path from "path";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";
import { Config } from "../Config";
import { Notification } from "../model/Notification";

let config: Config;
const logger = OTelLogger().createModuleLogger(path.basename(__filename));
const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));
const PUSH_TIMEOUT_MS = 5_000;
const PUSH_FANOUT_TIMEOUT_MS = 10_000;
const PUSH_CONCURRENCY = 10;
let pushFailuresCounter: { add: (value: number) => void };

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
    const endpoint = subscription.endpoint;
    // Check if already subscribed
    const existing = await DbUtilsQuerySQL(
      span,
      "SELECT * FROM push_subscriptions WHERE endpoint = ?",
      [endpoint],
    );
    if (existing.length > 0) {
      await DbUtilsExecSQL(
        span,
        "UPDATE push_subscriptions SET subscription = ? WHERE endpoint = ?",
        [JSON.stringify(subscription), endpoint],
      );
    } else {
      await DbUtilsExecSQL(
        span,
        'INSERT INTO push_subscriptions ("userId", endpoint, subscription) VALUES (?, ?, ?)',
        [userId, endpoint, JSON.stringify(subscription)],
      );
    }
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

export async function PushSendToAll(notification: Notification): Promise<void> {
  if (!config?.VAPID_PUBLIC_KEY || !config?.VAPID_PRIVATE_KEY) {
    return;
  }
  const span = OTelTracer().startSpan("PushSendToAll");
  try {
    const subscriptions = await DbUtilsQuerySQL(
      span,
      "SELECT * FROM push_subscriptions",
    );
    const payload = JSON.stringify({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      source: notification.source,
      data: notification.data,
      url: "/",
    });

    let nextIndex = 0;
    let skippedSubscriptions = 0;
    const deadline = Date.now() + PUSH_FANOUT_TIMEOUT_MS;
    const sendNext = async (): Promise<void> => {
      while (nextIndex < subscriptions.length) {
        if (Date.now() + PUSH_TIMEOUT_MS > deadline) {
          skippedSubscriptions += subscriptions.length - nextIndex;
          nextIndex = subscriptions.length;
          return;
        }
        const sub = subscriptions[nextIndex++];
        try {
          const subscription = JSON.parse(sub.subscription);
          await webpush.sendNotification(subscription, payload, {
            timeout: PUSH_TIMEOUT_MS,
          });
        } catch (error) {
          const statusCode =
            typeof error === "object" && error !== null && "statusCode" in error
              ? Number(error.statusCode)
              : undefined;
          if (statusCode === 404 || statusCode === 410) {
            try {
              await DbUtilsExecSQL(
                span,
                "DELETE FROM push_subscriptions WHERE endpoint = ?",
                [sub.endpoint],
              );
            } catch (pruneError) {
              logger.error(
                "Failed to prune expired push subscription",
                toError(pruneError),
                span,
              );
            }
            continue;
          }
          pushFailuresCounter ??= OTelMeter().createCounter("push.failures");
          pushFailuresCounter.add(1);
          let endpointOrigin = "invalid subscription";
          try {
            endpointOrigin = new URL(sub.endpoint).origin;
          } catch {
            // Invalid stored endpoints are reported without exposing their full value.
          }
          logger.warn(
            `Push delivery failed for ${endpointOrigin} (status ${
              statusCode ?? "unknown"
            }): ${error}`,
            span,
          );
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PUSH_CONCURRENCY, subscriptions.length) },
        () => sendNext(),
      ),
    );
    if (skippedSubscriptions > 0) {
      pushFailuresCounter ??= OTelMeter().createCounter("push.failures");
      pushFailuresCounter.add(skippedSubscriptions);
      logger.warn(
        `Push fan-out deadline reached; skipped ${skippedSubscriptions} subscription(s)`,
        span,
      );
    }
  } finally {
    span.end();
  }
}
