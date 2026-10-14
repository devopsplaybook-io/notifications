import * as nodemailer from "nodemailer";
import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";
import { Config } from "../Config";
import { Notification } from "../model/Notification";

const logger = OTelLogger().createModuleLogger("EmailQueue");
const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const EMAIL_SUBJECT_MAX = 200;
export const EMAIL_BODY_MAX = 10000;

export const EmailQueueSettings = {
  maxAttempts: 3,
  retryBaseDelayMs: 2_000,
  sendTimeoutMs: 10_000,
  concurrency: 3,
  maxQueueSize: 100,
};

export interface EmailJob {
  notification: Notification;
  recipient: string;
}

let transport: nodemailer.Transporter | undefined;
let smtpFrom = "";
let appPublicUrl = "";
let emailFailuresCounter: { add: (value: number) => void };

function countEmailFailure(count = 1): void {
  emailFailuresCounter ??= OTelMeter().createCounter("email.failures");
  emailFailuresCounter.add(count);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Mask the local part of a recipient address for logs: failures are logged
 * with retries and the full address would leak personal data into telemetry.
 */
export function MaskRecipient(recipient: string): string {
  const at = recipient.lastIndexOf("@");
  if (at <= 0) {
    return "***";
  }
  const local = recipient.slice(0, at);
  return `${local.slice(0, 2)}***${recipient.slice(at)}`;
}

export function EmailQueueSetTransport(
  transportIn: nodemailer.Transporter | undefined,
  smtpFromIn: string,
  appPublicUrlIn: string,
): void {
  transport = transportIn;
  smtpFrom = smtpFromIn;
  appPublicUrl = appPublicUrlIn;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the email for a notification. The title/body come from API-token
 * producers, so the HTML part escapes every value; a plain-text part is
 * always included.
 */
export function BuildEmailMessage(
  notification: Notification,
  recipient: string,
): nodemailer.SendMailOptions {
  const severity = notification.severity || "info";
  const source = notification.source || "";
  const subject = truncate(
    `[Notifications] ${severity}${source ? ` (${source})` : ""}: ${notification.title || ""}`,
    EMAIL_SUBJECT_MAX,
  );
  const link = appPublicUrl || "";
  const received = notification.createdAt
    ? new Date(notification.createdAt).toUTCString()
    : "";
  const textParts = [
    `${severity}${source ? ` from ${source}` : ""}`,
    "",
    notification.title || "",
    notification.body || "",
    "",
    received ? `Received: ${received}` : "",
    link ? `Open: ${link}` : "",
  ].filter((part) => part !== "");
  const bodyHtml = escapeHtml(notification.body || "").replace(/\n/g, "<br>");
  const htmlParts = [
    `<p><strong>${escapeHtml(severity)}</strong>${
      source ? ` from <strong>${escapeHtml(source)}</strong>` : ""
    }</p>`,
    `<h3>${escapeHtml(notification.title || "")}</h3>`,
    notification.body ? `<p>${bodyHtml}</p>` : "",
    received ? `<p style="color: #666">Received: ${escapeHtml(received)}</p>` : "",
    link
      ? `<p><a href="${escapeHtml(link)}">Open Notifications</a></p>`
      : "",
  ].filter((part) => part !== "");
  return {
    from: smtpFrom,
    to: recipient,
    subject,
    text: textParts.join("\n"),
    html: htmlParts.join("\n"),
  };
}

const queue: EmailJob[] = [];
let processing = false;
let idleResolvers: Array<() => void> = [];

export function EmailQueueEnqueue(job: EmailJob): void {
  if (queue.length >= EmailQueueSettings.maxQueueSize) {
    countEmailFailure();
    logger.warn(
      `Email queue full (${EmailQueueSettings.maxQueueSize}); dropping notification ${job.notification.id} for ${MaskRecipient(job.recipient)}`,
    );
    return;
  }
  queue.push(job);
  void processQueue();
}

export function EmailQueueWaitForIdle(): Promise<void> {
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
    const workerCount = Math.min(EmailQueueSettings.concurrency, queue.length);
    await Promise.all(
      Array.from({ length: workerCount }, () => deliverNext()),
    );
  } finally {
    processing = false;
    const resolvers = idleResolvers;
    idleResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }
}

async function deliverNext(): Promise<void> {
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) {
      return;
    }
    try {
      await deliverEmail(job);
    } catch (error) {
      countEmailFailure();
      logger.error(
        `Email queue delivery failed for notification ${job.notification.id} to ${MaskRecipient(job.recipient)}`,
        toError(error),
      );
    }
  }
}

function sendWithTimeout(message: nodemailer.SendMailOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Email send timed out after ${EmailQueueSettings.sendTimeoutMs}ms`)),
      EmailQueueSettings.sendTimeoutMs,
    );
    transport
      .sendMail(message)
      .then(() => resolve())
      .catch((error) => reject(toError(error)))
      .finally(() => clearTimeout(timer));
  });
}

async function deliverEmail(job: EmailJob): Promise<void> {
  const span: Span = OTelTracer().startSpan("EmailQueueDeliver");
  try {
    if (!transport) {
      logger.warn(
        `Email not configured; dropping notification ${job.notification.id} for ${MaskRecipient(job.recipient)}`,
        span,
      );
      return;
    }
    const message = BuildEmailMessage(job.notification, job.recipient);
    for (let attempt = 1; attempt <= EmailQueueSettings.maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await delay(EmailQueueSettings.retryBaseDelayMs * 2 ** (attempt - 2));
      }
      try {
        await sendWithTimeout(message);
        return;
      } catch (error) {
        logger.warn(
          `Email delivery failed for ${MaskRecipient(job.recipient)} (attempt ${attempt}/${EmailQueueSettings.maxAttempts}): ${error}`,
          span,
        );
        if (attempt === EmailQueueSettings.maxAttempts) {
          countEmailFailure();
        }
      }
    }
  } finally {
    span.end();
  }
}

export function CreateTransportFromConfig(config: Config): nodemailer.Transporter | undefined {
  if (!config.SMTP_HOST || !config.SMTP_FROM) {
    return undefined;
  }
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER
      ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: EmailQueueSettings.sendTimeoutMs,
    greetingTimeout: EmailQueueSettings.sendTimeoutMs,
    socketTimeout: EmailQueueSettings.sendTimeoutMs * 2,
  });
}
