import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Span } from "@opentelemetry/sdk-trace-base";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { User } from "../model/User";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));

export async function UsersDataList(context: Span): Promise<User[]> {
  const span = OTelTracer().startSpan("UsersDataList", context);
  try {
    return await DbUtilsQuerySQL(span, "SELECT * FROM users ORDER BY name");
  } finally {
    span.end();
  }
}

export async function UsersDataGet(
  context: Span,
  userId: string,
): Promise<User> {
  const span = OTelTracer().startSpan("UsersDataGet", context);
  try {
    const result = await DbUtilsQuerySQL(
      span,
      "SELECT * FROM users WHERE id = ?",
      [userId],
    );
    return result.length > 0 ? result[0] : null;
  } finally {
    span.end();
  }
}

export async function UsersDataGetByName(
  context: Span,
  name: string,
): Promise<User> {
  const span = OTelTracer().startSpan("UsersDataGetByName", context);
  try {
    const result = await DbUtilsQuerySQL(
      span,
      "SELECT * FROM users WHERE name = ?",
      [name],
    );
    return result.length > 0 ? result[0] : null;
  } finally {
    span.end();
  }
}

export async function UsersDataAdd(context: Span, user: User): Promise<void> {
  const span = OTelTracer().startSpan("UsersDataAdd", context);
  try {
    user.id = uuidv4();
    await DbUtilsExecSQL(
      span,
      "INSERT INTO users (id, name, passwordEncrypted) VALUES (?, ?, ?)",
      [user.id, user.name, user.passwordEncrypted],
    );
    logger.info(`User added: ${user.name}`, span);
  } finally {
    span.end();
  }
}

export async function UsersDataUpdate(
  context: Span,
  user: User,
): Promise<void> {
  const span = OTelTracer().startSpan("UsersDataUpdate", context);
  try {
    await DbUtilsExecSQL(
      span,
      "UPDATE users SET name = ?, passwordEncrypted = ? WHERE id = ?",
      [user.name, user.passwordEncrypted, user.id],
    );
  } finally {
    span.end();
  }
}
