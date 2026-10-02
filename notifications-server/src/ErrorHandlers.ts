import { FastifyInstance } from "fastify";
import * as path from "path";
import { OTelLogger, OTelRequestSpan } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("ErrorHandlers");

/**
 * Central error handler for the API.
 *
 * When the response has already started (headers sent, e.g. a streamed
 * static file that errored mid-flight), sending again would trigger
 * ERR_HTTP_HEADERS_SENT; in that case only log the error.
 */
export function RegisterErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler(
    (error: Error & { statusCode?: number }, request, reply) => {
      if (reply.raw.headersSent || reply.sent) {
        logger.error(
          "Unhandled API error after response started",
          error,
          OTelRequestSpan(request),
        );
        return;
      }
      if (error.statusCode && error.statusCode < 500) {
        return reply
          .status(error.statusCode)
          .send({ error: error.message || "Bad Request" });
      }
      logger.error("Unhandled API error", error, OTelRequestSpan(request));
      return reply.status(500).send({ error: "Internal Server Error" });
    },
  );
}

/**
 * SPA fallback: non-API, extension-less GET paths that do not match a static
 * file resolve to index.html; API and file paths return JSON 404. Both
 * branches return explicitly so the reply is only sent once.
 */
export function RegisterNotFoundHandler(fastify: FastifyInstance): void {
  fastify.setNotFoundHandler((request, reply) => {
    if (
      request.raw.url &&
      !request.raw.url.startsWith("/api/") &&
      !path.extname(request.raw.url)
    ) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send({ error: "Not Found" });
  });
}
