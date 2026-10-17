import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Span } from "@opentelemetry/sdk-trace-base";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import { OTelLogger, OTelTracer } from "../OTelContext";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));

const TITLE_MAX_LENGTH = 500;
const ERROR_MAX_LENGTH = 500;
const RECENT_LIMIT = 50;

export interface EmailDelivery {
  id: string;
  recipient: string;
  notificationId: string;
  notificationTitle: string;
  source: string;
  severity: string;
  status: string;
  attempts: number;
  error: string;
  createdAt: string;
}

export interface EmailDeliveryOutcome {
  recipient: string;
  notificationId: string;
  notificationTitle: string;
  source: string;
  severity: string;
  status: string;
  attempts: number;
  error: string;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Persist one delivery outcome (sent or failed) for the Recent Deliveries view. */
export async function EmailDeliveriesRecord(
  context: Span,
  outcome: EmailDeliveryOutcome,
): Promise<void> {
  const span = OTelTracer().startSpan("EmailDeliveriesRecord", context);
  try {
    const id = uuidv4();
    await DbUtilsExecSQL(
      span,
      'INSERT INTO email_deliveries (id, recipient, "notificationId", "notificationTitle", source, severity, status, attempts, error, "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        outcome.recipient,
        outcome.notificationId,
        truncate(outcome.notificationTitle, TITLE_MAX_LENGTH),
        outcome.source,
        outcome.severity,
        outcome.status,
        outcome.attempts,
        truncate(outcome.error, ERROR_MAX_LENGTH),
        new Date().toISOString(),
      ],
    );
  } finally {
    span.end();
  }
}

/** Most recent deliveries, newest first, capped to keep the settings view light. */
export async function EmailDeliveriesList(
  context: Span,
): Promise<EmailDelivery[]> {
  const span = OTelTracer().startSpan("EmailDeliveriesList", context);
  try {
    return await DbUtilsQuerySQL(
      span,
      'SELECT id, recipient, "notificationId", "notificationTitle", source, severity, status, attempts, error, "createdAt" FROM email_deliveries ORDER BY "createdAt" DESC LIMIT ' +
        RECENT_LIMIT,
    );
  } finally {
    span.end();
  }
}

export async function EmailDeliveriesPrune(
  context: Span,
  cutoff: string,
): Promise<number> {
  const span = OTelTracer().startSpan("EmailDeliveriesPrune", context);
  try {
    const deleted = await DbUtilsExecSQL(
      span,
      'DELETE FROM email_deliveries WHERE "createdAt" < ?',
      [cutoff],
    );
    logger.info(
      `Pruned ${deleted} email delivery record(s) older than ${cutoff}`,
      span,
    );
    return deleted;
  } finally {
    span.end();
  }
}
