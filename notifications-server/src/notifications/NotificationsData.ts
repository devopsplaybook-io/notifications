import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Span } from "@opentelemetry/sdk-trace-base";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { Notification } from "../model/Notification";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));

export async function NotificationsDataList(
  context: Span,
  limit: number = 50,
  offset: number = 0,
): Promise<Notification[]> {
  const span = OTelTracer().startSpan("NotificationsDataList", context);
  try {
    return await DbUtilsQuerySQL(
      span,
      "SELECT * FROM notifications ORDER BY createdAt DESC LIMIT ? OFFSET ?",
      [limit, offset],
    );
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
    return result.length > 0 ? result[0] : null;
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
      "INSERT INTO notifications (id, title, body, source, severity, data, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        notification.id,
        notification.title,
        notification.body,
        notification.source,
        notification.severity,
        notification.data,
        notification.createdAt,
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
): Promise<number> {
  const span = OTelTracer().startSpan("NotificationsDataCount", context);
  try {
    const result = await DbUtilsQuerySQL(
      span,
      "SELECT COUNT(*) as count FROM notifications",
    );
    return result.length > 0 ? result[0].count : 0;
  } finally {
    span.end();
  }
}
