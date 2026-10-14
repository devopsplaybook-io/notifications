import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "../OTelContext";
import { AuthGetUserSession } from "../users/Auth";
import {
  EmailRulesList,
  EmailRulesGet,
  EmailRulesCreate,
  EmailRulesUpdate,
  EmailRulesDelete,
} from "./EmailRulesData";
import { EmailIsConfigured, EmailSendTest } from "./EmailService";

const RECIPIENT_MAX_LENGTH = 320;
const RECIPIENT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE_MAX_LENGTH = 200;
const SEVERITY_MAX_LENGTH = 20;

/**
 * A recipient must be a plain address (no display name): anything outside the
 * simple address shape — including CR/LF, which would enable SMTP header
 * injection — is rejected.
 */
export function IsValidEmailRecipient(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (value.length === 0 || value.length > RECIPIENT_MAX_LENGTH) {
    return false;
  }
  if (value.includes("\n") || value.includes("\r")) {
    return false;
  }
  return RECIPIENT_PATTERN.test(value);
}

/** An empty source (or one that is whitespace-only) is the "any service" wildcard. */
export function NormalizeRuleSource(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string" || value.trim().length > SOURCE_MAX_LENGTH) {
    return undefined;
  }
  return value.trim();
}

/** An empty severity (or one that is whitespace-only) is the "any severity" wildcard. */
export function NormalizeRuleSeverity(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string" || value.trim().length > SEVERITY_MAX_LENGTH) {
    return undefined;
  }
  return value.trim();
}

function RulePayloadFrom(body: {
  source?: unknown;
  severity?: unknown;
}): { source?: string; severity?: string } {
  return {
    source: NormalizeRuleSource(body?.source),
    severity: NormalizeRuleSeverity(body?.severity),
  };
}

export class EmailRulesRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // List email rules (requires user auth)
    fastify.get("/rules", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const rules = await EmailRulesList(OTelRequestSpan(req));
      return res.status(200).send({ rules });
    });

    // Create an email rule (requires user auth)
    interface PostRule extends RequestGenericInterface {
      Body: {
        source?: unknown;
        severity?: unknown;
        recipient?: unknown;
      };
    }
    fastify.post<PostRule>("/rules", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const { source, severity } = RulePayloadFrom(req.body ?? {});
      if (source === undefined) {
        return res.status(400).send({ error: "Invalid: source" });
      }
      if (severity === undefined) {
        return res.status(400).send({ error: "Invalid: severity" });
      }
      if (!IsValidEmailRecipient(req.body?.recipient)) {
        return res.status(400).send({ error: "Invalid: recipient" });
      }
      const rule = await EmailRulesCreate(
        OTelRequestSpan(req),
        source,
        severity,
        req.body.recipient,
      );
      return res.status(201).send(rule);
    });

    // Update an email rule (requires user auth)
    interface PutRule extends RequestGenericInterface {
      Params: {
        id: string;
      };
      Body: {
        source?: unknown;
        severity?: unknown;
        recipient?: unknown;
      };
    }
    fastify.put<PutRule>("/rules/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const existing = await EmailRulesGet(OTelRequestSpan(req), req.params.id);
      if (!existing) {
        return res.status(404).send({ error: "Email rule not found" });
      }
      const { source, severity } = RulePayloadFrom(req.body ?? {});
      if (source === undefined) {
        return res.status(400).send({ error: "Invalid: source" });
      }
      if (severity === undefined) {
        return res.status(400).send({ error: "Invalid: severity" });
      }
      if (!IsValidEmailRecipient(req.body?.recipient)) {
        return res.status(400).send({ error: "Invalid: recipient" });
      }
      const updated = await EmailRulesUpdate(
        OTelRequestSpan(req),
        req.params.id,
        source,
        severity,
        req.body.recipient,
      );
      if (!updated) {
        return res.status(404).send({ error: "Email rule not found" });
      }
      return res.status(200).send({ success: true });
    });

    // Delete an email rule (requires user auth)
    fastify.delete("/rules/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const deleted = await EmailRulesDelete(
        OTelRequestSpan(req),
        (req.params as { id: string }).id,
      );
      if (!deleted) {
        return res.status(404).send({ error: "Email rule not found" });
      }
      return res.status(200).send({ success: true });
    });

    // Whether SMTP is configured (drives the settings UI banner)
    fastify.get("/status", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      return res.status(200).send({ smtpConfigured: EmailIsConfigured() });
    });

    // Send a test email (requires user auth)
    interface PostTest extends RequestGenericInterface {
      Body: {
        recipient?: unknown;
      };
    }
    fastify.post<PostTest>("/test", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      if (!IsValidEmailRecipient(req.body?.recipient)) {
        return res.status(400).send({ error: "Invalid: recipient" });
      }
      if (!EmailIsConfigured()) {
        return res.status(400).send({ error: "Email not configured" });
      }
      try {
        await EmailSendTest(OTelRequestSpan(req), req.body.recipient);
      } catch (error) {
        req.log.error(error, "Test email delivery failed");
        return res.status(502).send({ error: "Test email delivery failed" });
      }
      return res.status(200).send({ success: true });
    });
  }
}
