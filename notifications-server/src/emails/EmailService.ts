import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelTracer } from "../OTelContext";
import { Config } from "../Config";
import { Notification } from "../model/Notification";
import {
  BuildEmailMessage,
  CreateTransportFromConfig,
  EmailQueueEnqueue,
  EmailQueueSetTransport,
} from "./EmailQueue";
import { EmailRulesMatching } from "./EmailRulesData";

let config: Config;

export function EmailIsConfigured(): boolean {
  return !!config?.SMTP_HOST && !!config?.SMTP_FROM;
}

export function EmailInit(configIn: Config): void {
  config = configIn;
  EmailQueueSetTransport(
    CreateTransportFromConfig(config),
    config.SMTP_FROM,
    config.APP_PUBLIC_URL,
  );
}

/**
 * Evaluate the email rules for a newly created notification and enqueue one
 * email per distinct matching recipient. Multiple rules matching the same
 * recipient produce a single email; evaluation failure must never fail the
 * notification API call (the caller wraps this in its own try/catch).
 */
export async function EmailEvaluateNotification(
  context: Span,
  notification: Notification,
): Promise<void> {
  if (!EmailIsConfigured()) {
    return;
  }
  const span = OTelTracer().startSpan("EmailEvaluateNotification", context);
  try {
    const rules = await EmailRulesMatching(
      span,
      notification.source,
      notification.severity,
    );
    const recipients = [...new Set(rules.map((rule) => rule.recipient))];
    for (const recipient of recipients) {
      EmailQueueEnqueue({ notification, recipient });
    }
  } finally {
    span.end();
  }
}

/**
 * Send a test email immediately (not queued) so the caller can report the
 * delivery outcome; throws when the transport is not configured or the SMTP
 * server rejects the message.
 */
export async function EmailSendTest(
  context: Span,
  recipient: string,
): Promise<void> {
  const span = OTelTracer().startSpan("EmailSendTest", context);
  try {
    const transport = CreateTransportFromConfig(config);
    if (!transport) {
      throw new Error("Email not configured");
    }
    const testNotification = new Notification();
    testNotification.title = "Test email";
    testNotification.body =
      "This is a test email from the Notifications email rules feature.";
    testNotification.source = "notifications";
    testNotification.severity = "info";
    testNotification.createdAt = new Date().toISOString();
    await transport.sendMail(
      BuildEmailMessage(testNotification, recipient),
    );
  } finally {
    span.end();
  }
}
