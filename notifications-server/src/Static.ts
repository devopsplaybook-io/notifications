import fastifyStatic from "@fastify/static";
import { FastifyInstance, FastifyReply } from "fastify";
import * as path from "path";

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const NO_CACHE_CONTROL = "no-cache";

// All Nuxt build output is content-hashed except the outdated-build pointer,
// which Nuxt fetches to detect new builds and must stay fresh.
const MUTABLE_NUXT_FILES = new Set(["_nuxt/builds/latest.json"]);

export function SetStaticCacheHeaders(root: string) {
  return (reply: FastifyReply, filePath: string): void => {
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    const immutable =
      relativePath.startsWith("_nuxt/") &&
      !MUTABLE_NUXT_FILES.has(relativePath);
    reply.header(
      "Cache-Control",
      immutable ? IMMUTABLE_CACHE_CONTROL : NO_CACHE_CONTROL,
    );
  };
}

export function RegisterStatic(
  fastify: FastifyInstance,
  root = path.join(__dirname, "../web"),
): void {
  fastify.register(fastifyStatic, {
    root,
    prefix: "/",
    wildcard: false,
    setHeaders: SetStaticCacheHeaders(root),
  });
}
