import * as jwt from "jsonwebtoken";
import * as path from "path";
import { User } from "../model/User";
import { UserSession } from "../model/UserSession";
import { Config } from "../Config";
import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { UsersDataGet } from "./UsersData";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));
let config: Config;

export function AuthValidateJWTKey(key: string): void {
  if (
    typeof key !== "string" ||
    key.length < 32 ||
    key === "dev" ||
    new Set(key).size < 10
  ) {
    throw new Error(
      "JWT_KEY must be configured with at least 32 characters and 10 distinct characters",
    );
  }
}

/**
 * The JWT signing key is environment/secret-only: it is never read from or
 * written to the database (migration init-0005 purges the legacy metadata
 * row). Rotating JWT_KEY and restarting the service invalidates all existing
 * sessions; clients simply log in again.
 */
export async function AuthInit(_context: Span, configIn: Config) {
  AuthValidateJWTKey(configIn.JWT_KEY);
  config = configIn;
}

export async function AuthGenerateJWT(user: User): Promise<string> {
  return jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + config.JWT_VALIDITY_DURATION,
      userId: user.id,
      userName: user.name,
      tokenVersion: user.tokenVersion ?? 0,
    },
    config.JWT_KEY,
  );
}

/** Minimum age of a token before it gets renewed (24h). */
const AUTH_RENEWAL_THRESHOLD_SECONDS = 24 * 60 * 60;

/**
 * Sessions are bound to the per-user tokenVersion stored in the users table
 * (bumped on password change and logout). Tokens issued before the
 * tokenVersion migration carry no claim and count as version 0, so existing
 * sessions stay valid until the user revokes them.
 * Returns null when the user is gone or the token has been revoked.
 */
async function AuthGetSessionUser(info: jwt.JwtPayload): Promise<User | null> {
  const span = OTelTracer().startSpan("AuthCheckTokenVersion");
  try {
    const user = await UsersDataGet(span, info.userId);
    if (!user) {
      return null;
    }
    return Number(user.tokenVersion ?? 0) === Number(info.tokenVersion ?? 0)
      ? user
      : null;
  } finally {
    span.end();
  }
}

/**
 * Re-issue a fresh session token for an authenticated request whose token is
 * older than the renewal threshold.  The renewed token is sent via the
 * "X-Renewed-Token" response header and picked up by the web client, keeping
 * active sessions alive (sliding session).  Revoked tokens are never renewed.
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
    const user = await AuthGetSessionUser(info);
    if (!user) {
      logger.warn(`Session renewal rejected for user: ${info.userName}`);
      return;
    }
    res.header("X-Renewed-Token", await AuthGenerateJWT(user));
    logger.info(`Session renewed for user: ${user.name}`);
  } catch {
    // Invalid or expired tokens are handled by the regular auth checks
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function AuthGetUserSession(req: any): Promise<UserSession> {
  const userSession: UserSession = { isAuthenticated: false, userId: null };
  if (req.headers.authorization) {
    const bearerToken = req.headers.authorization.split(" ")[1];
    if (
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        bearerToken || "",
      )
    ) {
      return userSession;
    }
    try {
      const parts = req.headers.authorization.split(" ");
      if (parts.length !== 2 || parts[0] !== "Bearer") {
        logger.warn(
          "Invalid authorization header format (expected: Bearer <token>)",
        );
        return userSession;
      }
      const info = jwt.verify(parts[1], config.JWT_KEY) as jwt.JwtPayload;
      if (!(await AuthGetSessionUser(info))) {
        logger.warn(`Revoked or unknown session for user: ${info.userName}`);
        return userSession;
      }
      userSession.userId = info.userId;
      userSession.isAuthenticated = true;
    } catch (err) {
      logger.warn(`Invalid session token: ${(err as Error).name}`);
    }
  }
  return userSession;
}
