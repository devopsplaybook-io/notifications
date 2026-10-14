import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Span } from "@opentelemetry/sdk-trace-base";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import { OTelLogger, OTelTracer } from "../OTelContext";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));

export interface EmailRule {
  id: string;
  source: string;
  severity: string;
  recipient: string;
  createdAt: string;
}

export async function EmailRulesList(context: Span): Promise<EmailRule[]> {
  const span = OTelTracer().startSpan("EmailRulesList", context);
  try {
    return await DbUtilsQuerySQL(
      span,
      'SELECT id, source, severity, recipient, "createdAt" FROM email_rules ORDER BY "createdAt" DESC',
    );
  } finally {
    span.end();
  }
}

export async function EmailRulesGet(
  context: Span,
  id: string,
): Promise<EmailRule | undefined> {
  const span = OTelTracer().startSpan("EmailRulesGet", context);
  try {
    const result = await DbUtilsQuerySQL(
      span,
      'SELECT id, source, severity, recipient, "createdAt" FROM email_rules WHERE id = ?',
      [id],
    );
    return result.length > 0 ? result[0] : undefined;
  } finally {
    span.end();
  }
}

export async function EmailRulesCreate(
  context: Span,
  source: string,
  severity: string,
  recipient: string,
): Promise<EmailRule> {
  const span = OTelTracer().startSpan("EmailRulesCreate", context);
  try {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    await DbUtilsExecSQL(
      span,
      'INSERT INTO email_rules (id, source, severity, recipient, "createdAt") VALUES (?, ?, ?, ?, ?)',
      [id, source, severity, recipient, createdAt],
    );
    logger.info(`Email rule created: ${source || "any"}/${severity || "any"} -> ${recipient}`, span);
    return { id, source, severity, recipient, createdAt };
  } finally {
    span.end();
  }
}

export async function EmailRulesUpdate(
  context: Span,
  id: string,
  source: string,
  severity: string,
  recipient: string,
): Promise<boolean> {
  const span = OTelTracer().startSpan("EmailRulesUpdate", context);
  try {
    const updated = await DbUtilsExecSQL(
      span,
      'UPDATE email_rules SET source = ?, severity = ?, recipient = ? WHERE id = ?',
      [source, severity, recipient, id],
    );
    return updated > 0;
  } finally {
    span.end();
  }
}

export async function EmailRulesDelete(
  context: Span,
  id: string,
): Promise<number> {
  const span = OTelTracer().startSpan("EmailRulesDelete", context);
  try {
    const deleted = await DbUtilsExecSQL(
      span,
      "DELETE FROM email_rules WHERE id = ?",
      [id],
    );
    logger.info(`Email rule deleted: ${id} (${deleted} rows)`, span);
    return deleted;
  } finally {
    span.end();
  }
}

/**
 * Rules matching a notification. An empty rule source (or severity) is a
 * wildcard; the comparison is case-insensitive so a producer sending
 * "FluxCD" still matches a rule saved as "fluxcd".
 */
export async function EmailRulesMatching(
  context: Span,
  source: string,
  severity: string,
): Promise<EmailRule[]> {
  const span = OTelTracer().startSpan("EmailRulesMatching", context);
  try {
    return await DbUtilsQuerySQL(
      span,
      'SELECT id, source, severity, recipient, "createdAt" FROM email_rules ' +
        "WHERE (source = '' OR LOWER(source) = LOWER(?)) " +
        "AND (severity = '' OR LOWER(severity) = LOWER(?))",
      [source, severity],
    );
  } finally {
    span.end();
  }
}
