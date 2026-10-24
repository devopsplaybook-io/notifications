jest.mock("../dist/OTelContext", () => ({
  OTelRequestSpan: () => undefined,
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }),
}));

const fs = require("fs");
const os = require("os");
const path = require("path");
const Fastify = require("fastify");
const { RegisterNotFoundHandler } = require("../dist/ErrorHandlers");
const { RegisterSecurityHeaders } = require("../dist/SecurityHeaders");
const {
  IMMUTABLE_CACHE_CONTROL,
  NO_CACHE_CONTROL,
  RegisterStatic,
} = require("../dist/Static");

function buildWebRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notifications-web-"));
  fs.writeFileSync(path.join(root, "index.html"), "<html><body>SPA</body></html>");
  fs.writeFileSync(
    path.join(root, "manifest.json"),
    JSON.stringify({ name: "Notifications", short_name: "Notifications" }),
  );
  fs.writeFileSync(path.join(root, "sw.js"), "// service worker");
  fs.writeFileSync(path.join(root, "icon.png"), "png");
  fs.mkdirSync(path.join(root, "_nuxt", "builds", "meta"), { recursive: true });
  fs.writeFileSync(path.join(root, "_nuxt", "entry.abc123.js"), "// entry");
  fs.writeFileSync(path.join(root, "_nuxt", "builds", "latest.json"), "{}");
  fs.writeFileSync(
    path.join(root, "_nuxt", "builds", "meta", "build123.json"),
    "{}",
  );
  return root;
}

async function buildApp(root) {
  const app = Fastify();
  RegisterSecurityHeaders(app);
  RegisterStatic(app, root);
  RegisterNotFoundHandler(app);
  await app.ready();
  return app;
}

describe("static asset serving", () => {
  let root;
  let app;

  beforeEach(async () => {
    root = buildWebRoot();
    app = await buildApp(root);
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("hashed Nuxt build output is served immutable", async () => {
    for (const url of [
      "/_nuxt/entry.abc123.js",
      "/_nuxt/builds/meta/build123.json",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe(IMMUTABLE_CACHE_CONTROL);
    }
  });

  test("HEAD requests on hashed assets are immutable too", async () => {
    const response = await app.inject({
      method: "HEAD",
      url: "/_nuxt/entry.abc123.js",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  test("mutable static files are served with no-cache", async () => {
    for (const url of [
      "/",
      "/index.html",
      "/manifest.json",
      "/sw.js",
      "/_nuxt/builds/latest.json",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe(NO_CACHE_CONTROL);
    }
  });

  test("the SPA fallback serves index.html with no-cache", async () => {
    const response = await app.inject({ method: "GET", url: "/settings/profile" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("SPA");
    expect(response.headers["cache-control"]).toBe(NO_CACHE_CONTROL);
  });

  test("unknown API and file paths still return a JSON 404", async () => {
    for (const url of ["/missing.js", "/api/unknown"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(response.body)).toEqual({ error: "Not Found" });
    }
  });

  test("security headers are still applied to static responses", async () => {
    const response = await app.inject({ method: "GET", url: "/_nuxt/entry.abc123.js" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    const index = await app.inject({ method: "GET", url: "/" });
    expect(index.headers["x-content-type-options"]).toBe("nosniff");
    expect(index.headers["content-security-policy"]).toContain("default-src 'self'");
  });
});
