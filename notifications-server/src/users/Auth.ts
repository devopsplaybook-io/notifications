import * as jwt from "jsonwebtoken";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { User } from "../model/User";
import { UserSession } from "../model/UserSession";
import { Config } from "../Config";
import { Span } from "@opentelemetry/sdk-trace-base";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import { OTelLogger, OTelTracer } from "../OTelContext";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));
let config: Config;

export async function AuthInit(context: Span, configIn: Config) {
  config = configIn;
  const span = OTelTracer().startSpan("AuthInit", context);
  const authKeyRaw = await DbUtilsQuerySQL(
    span,
    "SELECT * FROM metadata WHERE type='auth_token'",
  );

  const configHasKey = configIn.JWT_KEY !== "";

  if (configHasKey) {
    if (authKeyRaw.length === 0) {
      await DbUtilsExecSQL(
        span,
        "INSERT INTO metadata (type, value, dateCreated) VALUES ('auth_token', ?, ?)",
        [configIn.JWT_KEY, new Date().toISOString()],
      );
    } else if (authKeyRaw[0].value !== configIn.JWT_KEY) {
      await DbUtilsExecSQL(
        span,
        "UPDATE metadata SET value = ? WHERE type = 'auth_token'",
        [configIn.JWT_KEY],
      );
    }
  } else if (authKeyRaw.length === 0) {
    configIn.JWT_KEY = uuidv4();
    await DbUtilsExecSQL(
      span,
      "INSERT INTO metadata (type, value, dateCreated) VALUES ('auth_token', ?, ?)",
      [configIn.JWT_KEY, new Date().toISOString()],
    );
  } else {
    configIn.JWT_KEY = authKeyRaw[0].value;
  }
  span.end();
}

export async function AuthGenerateJWT(user: User): Promise<string> {
  return jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + config.JWT_VALIDITY_DURATION,
      userId: user.id,
      userName: user.name,
    },
    config.JWT_KEY,
  );
}

/** Minimum age of a token before it gets renewed (24h). */
const AUTH_RENEWAL_THRESHOLD_SECONDS = 24 * 60 * 60;

/**
 * Re-issue a fresh session token for an authenticated request whose token is
 * older than the renewal threshold.  The renewed token is sent via the
 * "X-Renewed-Token" response header and picked up by the web client, keeping
 * active sessions alive (sliding session).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function AuthRenewSession(req: any, res: any): Promise<void> {
  if (!req.headers.authorization) {
    return;
  }
  try {
    const parts = req.headers.authorization.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return;
    }
    const info = jwt.verify(parts[1], config.JWT_KEY) as jwt.JwtPayload;
    const issuedAt = info.iat ?? 0;
    if (
      Math.floor(Date.now() / 1000) - issuedAt <
      AUTH_RENEWAL_THRESHOLD_SECONDS
    ) {
      return;
    }
    const user = new User();
    user.id = info.userId;
    user.name = info.userName;
    res.header("X-Renewed-Token", await AuthGenerateJWT(user));
    logger.info(`Session renewed for user: ${user.name}`);
  } catch {
    // Invalid or expired tokens are handled by the regular auth checks
  }
}

export async function AuthMustBeAuthenticated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
): Promise<void> {
  let authenticated = false;
  if (req.headers.authorization) {
    try {
      const parts = req.headers.authorization.split(" ");
      if (parts.length === 2 && parts[0] === "Bearer") {
        jwt.verify(parts[1], config.JWT_KEY);
        authenticated = true;
      }
    } catch {
      authenticated = false;
    }
  }
  if (!authenticated) {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function AuthGetUserSession(req: any): Promise<UserSession> {
  const userSession: UserSession = { isAuthenticated: false, userId: null };
  if (req.headers.authorization) {
    try {
      const parts = req.headers.authorization.split(" ");
      if (parts.length !== 2 || parts[0] !== "Bearer") {
        logger.warn(
          "Invalid authorization header format (expected: Bearer <token>)",
        );
        return userSession;
      }
      const info = jwt.verify(parts[1], config.JWT_KEY);
      userSession.userId = info.userId;
      userSession.isAuthenticated = true;
    } catch (err) {
      logger.error("Error Getting User Session", err);
    }
  }
  return userSession;
}
