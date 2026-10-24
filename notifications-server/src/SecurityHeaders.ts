import { FastifyInstance } from "fastify";

/**
 * Security headers applied to every response, including static files.
 *
 * 'unsafe-inline' in the CSP is required by the Nuxt static output (inline
 * importmap, payload scripts and styles); no external scripts are allowed.
 */
export function RegisterSecurityHeaders(fastify: FastifyInstance): void {
  fastify.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'self'; frame-ancestors 'none'",
    );
  });
}
