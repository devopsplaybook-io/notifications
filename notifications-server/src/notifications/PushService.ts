import * as webpush from "web-push";
import { Span } from "@opentelemetry/sdk-trace-base";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import { OTelTracer } from "../OTelContext";
import { Config } from "../Config";
import { Notification } from "../model/Notification";

let config: Config;

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
        "INSERT INTO push_subscriptions (userId, endpoint, subscription) VALUES (?, ?, ?)",
        [userId, endpoint, JSON.stringify(subscription)],
      );
    }
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
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      source: notification.source,
    });

    const promises = subscriptions.map(async (sub: Record<string, string>) => {
      try {
        const subscription = JSON.parse(sub.subscription);
        await webpush.sendNotification(subscription, payload);
      } catch (err) {
        // Remove invalid subscriptions
        if (err.statusCode === 404 || err.statusCode === 410) {
          await DbUtilsExecSQL(
            span,
            "DELETE FROM push_subscriptions WHERE endpoint = ?",
            [sub.endpoint],
          );
        }
      }
    });
    await Promise.all(promises);
  } finally {
    span.end();
  }
}
