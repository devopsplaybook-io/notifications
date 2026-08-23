import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Span } from "@opentelemetry/sdk-trace-base";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "@devopsplaybook.io/common-utils";
import { OTelLogger, OTelTracer } from "../OTelContext";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));

export async function ApiTokensList(context: Span): Promise<any[]> {
  const span = OTelTracer().startSpan("ApiTokensList", context);
  try {
    return await DbUtilsQuerySQL(
      span,
      "SELECT id, name, token, createdAt FROM api_tokens ORDER BY createdAt DESC",
    );
  } finally {
    span.end();
  }
}

export async function ApiTokensValidate(
  context: Span,
  token: string,
): Promise<boolean> {
  const span = OTelTracer().startSpan("ApiTokensValidate", context);
  try {
    const result = await DbUtilsQuerySQL(
      span,
      "SELECT * FROM api_tokens WHERE token = ?",
      [token],
    );
    return result.length > 0;
  } finally {
    span.end();
  }
}

export async function ApiTokensCreate(
  context: Span,
  name: string,
): Promise<{ id: string; name: string; token: string }> {
  const span = OTelTracer().startSpan("ApiTokensCreate", context);
  try {
    const id = uuidv4();
    const token = uuidv4();
    await DbUtilsExecSQL(
      span,
      "INSERT INTO api_tokens (id, name, token, createdAt) VALUES (?, ?, ?, ?)",
      [id, name, token, new Date().toISOString()],
    );
    logger.info(`API token created: ${name}`, span);
    return { id, name, token };
  } finally {
    span.end();
  }
}

export async function ApiTokensDelete(
  context: Span,
  id: string,
): Promise<void> {
  const span = OTelTracer().startSpan("ApiTokensDelete", context);
  try {
    await DbUtilsExecSQL(span, "DELETE FROM api_tokens WHERE id = ?", [id]);
    logger.info(`API token deleted: ${id}`, span);
  } finally {
    span.end();
  }
}
