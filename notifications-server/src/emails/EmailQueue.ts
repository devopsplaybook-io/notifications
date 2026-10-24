import * as nodemailer from "nodemailer";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";
import { Config } from "../Config";
import { Notification } from "../model/Notification";
import { EmailDeliveriesRecord } from "./EmailDeliveriesData";

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

const BODY_SANITIZER_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "em", "del", "s", "code", "pre",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "img",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    th: ["align"],
    td: ["align"],
    code: ["class"],
    pre: ["class", "style"],
    blockquote: ["style"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    pre: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        style: "background: #f6f8fa; padding: 12px; overflow-x: auto; white-space: pre-wrap;",
      },
    }),
    blockquote: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        style: "border-left: 4px solid #d0d7de; margin: 0 0 8px 0; padding-left: 12px; color: #666;",
      },
    }),
  },
};

/**
 * Render a notification body as email-safe HTML: markdown is interpreted the
 * same way as in the web UI (GFM + line breaks), then sanitized with an
 * allowlist so producer content can never inject scripts, styles or event
 * handlers.
 */
export function RenderBodyHtml(body: string): string {
  const html = marked.parse(body, { gfm: true, breaks: true }) as string;
  return sanitizeHtml(html, BODY_SANITIZER_OPTIONS);
}

/**
 * Build the email for a notification. The title/severity/source are escaped
 * and the body is markdown-rendered then sanitized (bodies come from API-token
 * producers); a plain-text part is always included.
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
  const htmlParts = [
    `<p><strong>${escapeHtml(severity)}</strong>${
      source ? ` from <strong>${escapeHtml(source)}</strong>` : ""
    }</p>`,
    `<h3>${escapeHtml(notification.title || "")}</h3>`,
    notification.body ? `<div>${RenderBodyHtml(notification.body)}</div>` : "",
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

/**
 * Persist a delivery outcome for the Recent Deliveries view. Fire-and-forget:
 * a recording failure must never break or delay the delivery itself.
 */
function recordDelivery(
  job: EmailJob,
  status: "sent" | "failed",
  attempts: number,
  error = "",
): void {
  EmailDeliveriesRecord(undefined, {
    recipient: job.recipient,
    notificationId: job.notification.id || "",
    notificationTitle: job.notification.title || "",
    source: job.notification.source || "",
    severity: job.notification.severity || "",
    status,
    attempts,
    error,
  }).catch((recordingError) => {
    logger.error(
      `Failed to record email delivery outcome for notification ${job.notification.id}`,
      toError(recordingError),
    );
  });
}

export function EmailQueueEnqueue(job: EmailJob): void {
  if (queue.length >= EmailQueueSettings.maxQueueSize) {
    countEmailFailure();
    logger.warn(
      `Email queue full (${EmailQueueSettings.maxQueueSize}); dropping notification ${job.notification.id} for ${MaskRecipient(job.recipient)}`,
    );
    recordDelivery(job, "failed", 0, "Email queue full");
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

export class EmailSendTimeoutError extends Error {
  public code: string;

  constructor(timeoutMs: number) {
    super(`Email send timed out after ${timeoutMs}ms`);
    this.name = "EmailSendTimeoutError";
    this.code = "ETIMEDOUT";
  }
}

/** True for our watchdog and for nodemailer's connect/greeting/socket timeouts. */
export function IsEmailTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ETIMEDOUT"
  );
}

/**
 * Send one message with a hard budget. On timeout the outcome is a failure.
 * With `waitForSettleOnTimeout` (queue) the rejection is delayed until the
 * underlying send settles, so a timed-out send is never overlapped by the
 * next job.
 */
export async function SendMailBounded(
  transporter: nodemailer.Transporter,
  message: nodemailer.SendMailOptions,
  timeoutMs: number,
  waitForSettleOnTimeout: boolean,
): Promise<void> {
  // The executor runs synchronously (so a synchronous sendMail throw becomes a
  // rejection) while the send itself keeps running in the background.
  const sendPromise = new Promise<void>((resolve, reject) => {
    transporter.sendMail(message).then(
      () => resolve(),
      (error) => reject(toError(error)),
    );
  });
  let timer: NodeJS.Timeout | undefined;
  const watchdog = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new EmailSendTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    await Promise.race([sendPromise, watchdog]);
  } catch (error) {
    if (waitForSettleOnTimeout && error instanceof EmailSendTimeoutError) {
      await sendPromise.catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function deliverEmail(job: EmailJob): Promise<void> {
  const span: Span = OTelTracer().startSpan("EmailQueueDeliver");
  try {
    if (!transport) {
      logger.warn(
        `Email not configured; dropping notification ${job.notification.id} for ${MaskRecipient(job.recipient)}`,
        span,
      );
      recordDelivery(job, "failed", 0, "SMTP not configured");
      return;
    }
    const message = BuildEmailMessage(job.notification, job.recipient);
    let lastError = "";
    for (let attempt = 1; attempt <= EmailQueueSettings.maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await delay(EmailQueueSettings.retryBaseDelayMs * 2 ** (attempt - 2));
      }
      try {
        await SendMailBounded(
          transport,
          message,
          EmailQueueSettings.sendTimeoutMs,
          true,
        );
        recordDelivery(job, "sent", attempt);
        return;
      } catch (error) {
        lastError = String(error);
        logger.warn(
          `Email delivery failed for ${MaskRecipient(job.recipient)} (attempt ${attempt}/${EmailQueueSettings.maxAttempts}): ${error}`,
          span,
        );
        if (IsEmailTimeoutError(error)) {
          // Ambiguous: the server may already have accepted the message, so
          // retrying would duplicate it. The failure is terminal.
          countEmailFailure();
          recordDelivery(job, "failed", attempt, lastError);
          return;
        }
        if (attempt === EmailQueueSettings.maxAttempts) {
          countEmailFailure();
        }
      }
    }
    recordDelivery(job, "failed", EmailQueueSettings.maxAttempts, lastError);
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
    socketTimeout: EmailQueueSettings.sendTimeoutMs,
  });
}
