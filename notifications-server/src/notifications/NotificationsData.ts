import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Span } from "@opentelemetry/sdk-trace-base";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { Notification } from "../model/Notification";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));

/** Read-state filter: "all" (default), "unread" or "read". */
export type NotificationReadFilter = "all" | "unread" | "read";

/** Map a DB row to a Notification with a normalized boolean read field. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRead(row: any): Notification {
  return { ...row, read: !!row.read };
}

export async function NotificationsDataList(
  context: Span,
  limit = 50,
  offset = 0,
  source = "",
  read: NotificationReadFilter = "all",
): Promise<Notification[]> {
  const span = OTelTracer().startSpan("NotificationsDataList", context);
  try {
    const conditions: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [];
    if (source) {
      conditions.push("source = ?");
      params.push(source);
    }
    // "read"/"NOT read" work on both SQLite (0/1) and Postgres (BOOLEAN)
    if (read === "unread") {
      conditions.push("NOT read");
    } else if (read === "read") {
      conditions.push("read");
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit, offset);
    const result = await DbUtilsQuerySQL(
      span,
      `SELECT * FROM notifications ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
      params,
    );
    return result.map(normalizeRead);
  } finally {
    span.end();
  }
}

export async function NotificationsDataSources(
  context: Span,
): Promise<string[]> {
  const span = OTelTracer().startSpan("NotificationsDataSources", context);
  try {
    const result = await DbUtilsQuerySQL(
      span,
      "SELECT DISTINCT source FROM notifications ORDER BY source ASC",
    );
    return result.map((row) => row.source);
  } finally {
    span.end();
  }
}

export async function NotificationsDataGet(
  context: Span,
  id: string,
): Promise<Notification> {
  const span = OTelTracer().startSpan("NotificationsDataGet", context);
  try {
    const result = await DbUtilsQuerySQL(
      span,
      "SELECT * FROM notifications WHERE id = ?",
      [id],
    );
    return result.length > 0 ? normalizeRead(result[0]) : null;
  } finally {
    span.end();
  }
}

export async function NotificationsDataAdd(
  context: Span,
  notification: Notification,
): Promise<Notification> {
  const span = OTelTracer().startSpan("NotificationsDataAdd", context);
  try {
    notification.id = uuidv4();
    notification.createdAt = new Date().toISOString();
    await DbUtilsExecSQL(
      span,
      "INSERT INTO notifications (id, title, body, source, severity, data, createdAt, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        notification.id,
        notification.title,
        notification.body,
        notification.source,
        notification.severity,
        notification.data,
        notification.createdAt,
        notification.read ? 1 : 0,
      ],
    );
    logger.info(`Notification added: ${notification.title}`, span);
    return notification;
  } finally {
    span.end();
  }
}

export async function NotificationsDataCount(
  context: Span,
  source = "",
  read: NotificationReadFilter = "all",
): Promise<number> {
  const span = OTelTracer().startSpan("NotificationsDataCount", context);
  try {
    const conditions: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [];
    if (source) {
      conditions.push("source = ?");
      params.push(source);
    }
    if (read === "unread") {
      conditions.push("NOT read");
    } else if (read === "read") {
      conditions.push("read");
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await DbUtilsQuerySQL(
      span,
      `SELECT COUNT(*) as count FROM notifications ${where}`,
      params,
    );
    return result.length > 0 ? result[0].count : 0;
  } finally {
    span.end();
  }
}

export async function NotificationsDataUpdateRead(
  context: Span,
  id: string,
  read: boolean,
): Promise<boolean> {
  const span = OTelTracer().startSpan("NotificationsDataUpdateRead", context);
  try {
    const changes = await DbUtilsExecSQL(
      span,
      "UPDATE notifications SET read = ? WHERE id = ?",
      [read ? 1 : 0, id],
    );
    logger.info(`Notification read state updated: ${id} -> ${read}`, span);
    return changes > 0;
  } finally {
    span.end();
  }
}

export async function NotificationsDataDelete(
  context: Span,
  id: string,
): Promise<boolean> {
  const span = OTelTracer().startSpan("NotificationsDataDelete", context);
  try {
    await DbUtilsExecSQL(span, "DELETE FROM notifications WHERE id = ?", [id]);
    logger.info(`Notification deleted: ${id}`, span);
    return true;
  } finally {
    span.end();
  }
}

export async function NotificationsDataDeleteAll(
  context: Span,
): Promise<number> {
  const span = OTelTracer().startSpan("NotificationsDataDeleteAll", context);
  try {
    const countBefore = await NotificationsDataCount(span);
    await DbUtilsExecSQL(span, "DELETE FROM notifications", []);
    logger.info(`All notifications deleted (${countBefore} records)`, span);
    return countBefore;
  } finally {
    span.end();
  }
}
