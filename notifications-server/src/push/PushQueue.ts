import * as webpush from "web-push";
import { Span } from "@opentelemetry/sdk-trace-base";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import * as path from "path";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";
import { Notification } from "../model/Notification";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));
const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const PUSH_PAYLOAD_TITLE_MAX = 200;
export const PUSH_PAYLOAD_BODY_MAX = 1000;

export const PushQueueSettings = {
  maxAttempts: 3,
  retryBaseDelayMs: 2_000,
  pushTimeoutMs: 5_000,
  concurrency: 10,
  maxQueueSize: 1_000,
};

let pushFailuresCounter: { add: (value: number) => void };

function countPushFailure(count = 1): void {
  pushFailuresCounter ??= OTelMeter().createCounter("push.failures");
  pushFailuresCounter.add(count);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Build the Web Push payload. Push services cap payloads at ~4 KB, so the
 * title/body are truncated and the full `data` object is omitted; the app
 * fetches the complete notification from the API.
 */
export function BuildPushPayload(notification: Notification): string {
  return JSON.stringify({
    id: notification.id,
    title: truncate(notification.title || "", PUSH_PAYLOAD_TITLE_MAX),
    body: truncate(notification.body || "", PUSH_PAYLOAD_BODY_MAX),
    severity: notification.severity,
    source: notification.source,
    url: "/",
  });
}

const queue: Notification[] = [];
let processing = false;
let idleResolvers: Array<() => void> = [];

export function PushQueueEnqueue(notification: Notification): void {
  if (queue.length >= PushQueueSettings.maxQueueSize) {
    countPushFailure();
    logger.warn(
      `Push queue full (${PushQueueSettings.maxQueueSize}); dropping notification ${notification.id}`,
    );
    return;
  }
  queue.push(notification);
  void processQueue();
}

export function PushQueueWaitForIdle(): Promise<void> {
  if (!processing && queue.length === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    idleResolvers.push(resolve);
  });
}

async function processQueue(): Promise<void> {
  if (processing) {
    return;
  }
  processing = true;
  try {
    while (queue.length > 0) {
      const notification = queue.shift();
      try {
        await deliverNotification(notification);
      } catch (error) {
        countPushFailure();
        logger.error(
          `Push queue delivery failed for notification ${notification.id}`,
          toError(error),
        );
      }
    }
  } finally {
    processing = false;
    const resolvers = idleResolvers;
    idleResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }
}

async function deliverNotification(notification: Notification): Promise<void> {
  const span = OTelTracer().startSpan("PushQueueDeliver");
  try {
    const subscriptions = await DbUtilsQuerySQL(
      span,
      "SELECT * FROM push_subscriptions",
    );
    if (subscriptions.length === 0) {
      return;
    }
    const payload = BuildPushPayload(notification);
    let nextIndex = 0;
    const deliverNext = async (): Promise<void> => {
      while (nextIndex < subscriptions.length) {
        await deliverToSubscription(span, subscriptions[nextIndex++], payload);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PushQueueSettings.concurrency, subscriptions.length) },
        () => deliverNext(),
      ),
    );
  } finally {
    span.end();
  }
}

async function deliverToSubscription(
  span: Span,
  subscriptionRow: any,
  payload: string,
): Promise<void> {
  const endpoint =
    typeof subscriptionRow?.endpoint === "string" ? subscriptionRow.endpoint : "";
  for (let attempt = 1; attempt <= PushQueueSettings.maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await delay(PushQueueSettings.retryBaseDelayMs * 2 ** (attempt - 2));
    }
    try {
      const subscription = JSON.parse(subscriptionRow.subscription);
      await webpush.sendNotification(subscription, payload, {
        timeout: PushQueueSettings.pushTimeoutMs,
      });
      return;
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
            [endpoint],
          );
        } catch (pruneError) {
          logger.error(
            "Failed to prune expired push subscription",
            toError(pruneError),
            span,
          );
        }
        return;
      }
      let endpointOrigin = "invalid subscription";
      try {
        endpointOrigin = new URL(endpoint).origin;
      } catch {
        // Invalid stored endpoints are reported without exposing their full value.
      }
      logger.warn(
        `Push delivery failed for ${endpointOrigin} (status ${
          statusCode ?? "unknown"
        }, attempt ${attempt}/${PushQueueSettings.maxAttempts}): ${error}`,
        span,
      );
      if (attempt === PushQueueSettings.maxAttempts) {
        countPushFailure();
      }
    }
  }
}
