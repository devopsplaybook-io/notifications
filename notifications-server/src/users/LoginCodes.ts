import {
  LoginCodesEvent,
  LoginCodesOptionsFromConfig,
  LoginCodesRoutes,
  LoginCodesRoutesOptions,
  LoginCodesStore,
  createLoginCodesStoreCommonUtils,
} from "@devopsplaybook.io/common-utils/users/login-codes";
import type { FastifyInstance } from "fastify";
import { Config } from "../Config";
import { OTelLogger, OTelRequestSpan } from "../OTelContext";
import { ApiTokensValidate } from "../apitokens/ApiTokensData";
import { AuthGenerateJWT, AuthGetUserSession } from "./Auth";
import { UserPasswordCheckPassword } from "./UserPassword";
import { UsersDataGet } from "./UsersData";

const LOGIN_CODES_PREFIX = "/api/users/login-codes";
const logger = OTelLogger().createModuleLogger("login-codes");

function LoginCodesGetBearerToken(header?: string): string | undefined {
  return header?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

/**
 * Structured audit log for the login-code flow. Only allow-listed fields are
 * written: an event never carries a code, a request token or a header, so this
 * sink cannot leak a secret into the logs.
 */
export function LoginCodesLogEvent(event: LoginCodesEvent): void {
  logger.info(
    "[LoginCodes] " +
      JSON.stringify({
        type: event.type,
        requestId: event.requestId,
        userId: event.userId,
        userName: event.userName,
        deviceLabel: event.deviceLabel,
        reason: event.reason,
        ip: event.ip,
      }),
  );
}

/**
 * Build the `LoginCodesRoutes` options: the common-utils store, an approver
 * that must be an interactive JWT session (API keys are flagged so the library
 * answers 403), the notifications JWT session issuer, the bcrypt password
 * check and the structured event log.
 */
export function LoginCodesBuildRoutesOptions(
  config: Config,
  store: LoginCodesStore = createLoginCodesStoreCommonUtils(),
): LoginCodesRoutesOptions {
  return {
    ...LoginCodesOptionsFromConfig(config),
    store,
    // Evaluated lazily at the first request; an empty key makes the feature
    // answer 503 instead of crashing the plugin.
    hashKey: () => config.JWT_KEY,
    getApprovingUser: async (req) => {
      const span = OTelRequestSpan(req);
      const session = await AuthGetUserSession(req);
      if (session.isAuthenticated && session.userId) {
        const user = await UsersDataGet(span, session.userId);
        return user ? { id: user.id, name: user.name } : null;
      }
      const token = LoginCodesGetBearerToken(req.headers.authorization);
      if (token && (await ApiTokensValidate(span, token))) {
        // Flagged so LoginCodesRoutes answers 403: a long-lived API key must
        // never approve a sign-in and mint a fresh session.
        return { id: "", name: "", isApiToken: true };
      }
      return null; // 401 UNAUTHENTICATED
    },
    getUserById: async (id) => {
      const user = await UsersDataGet(undefined, id);
      return user ? { id: user.id, name: user.name } : null;
    },
    issueSession: async (approver, req) => {
      // Re-read the approver live: a deleted user fails the redemption closed.
      const user = await UsersDataGet(OTelRequestSpan(req), approver.id);
      if (!user) {
        throw new Error("Login code approver no longer exists");
      }
      return {
        token: await AuthGenerateJWT(user),
        user: { id: user.id, name: user.name }, // never passwordEncrypted
      };
    },
    verifyPassword: async (approver, password) => {
      const user = await UsersDataGet(undefined, approver.id);
      return user ? UserPasswordCheckPassword(undefined, user, password) : false;
    },
    onEvent: LoginCodesLogEvent,
  };
}

/** Mount the login-code routes; nothing is registered while the flag is off. */
export async function LoginCodesRegister(
  fastify: FastifyInstance,
  config: Config,
): Promise<void> {
  if (!config.LOGIN_CODE_ENABLED) {
    return;
  }
  fastify.register(
    async (instance) => {
      await LoginCodesRoutes(instance, LoginCodesBuildRoutesOptions(config));
    },
    { prefix: LOGIN_CODES_PREFIX },
  );
}
