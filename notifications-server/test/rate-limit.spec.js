const Fastify = require("fastify");
const { BoundedRateLimiter } = require("../dist/RateLimit");
const { AuthRateLimit } = require("../dist/users/AuthRateLimit");
const { ParseTrustedProxies } = require("../dist/Config");

describe("bounded rate limiter", () => {
  test("evicts expired buckets independently of the size cap", () => {
    const limiter = new BoundedRateLimiter({
      windowMs: 60_000,
      maxBuckets: 10_000,
    });
    const t0 = 1_000;
    expect(limiter.tryConsume("a", 5, t0)).toBe(true);
    expect(limiter.tryConsume("b", 5, t0)).toBe(true);
    expect(limiter.size).toBe(2);

    expect(limiter.tryConsume("c", 5, t0 + 60_001)).toBe(true);
    expect(limiter.size).toBe(1);
  });

  test("keeps the bucket map under the hard cap", () => {
    const limiter = new BoundedRateLimiter({ windowMs: 60_000, maxBuckets: 100 });
    for (let index = 0; index < 500; index += 1) {
      limiter.tryConsume(`key-${index}`, 1, 1_000 + index);
    }
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  test("rejects once a key reaches its limit and recovers after the window", () => {
    const limiter = new BoundedRateLimiter({ windowMs: 60_000, maxBuckets: 10 });
    expect(limiter.tryConsume("key", 2, 1_000)).toBe(true);
    expect(limiter.tryConsume("key", 2, 1_001)).toBe(true);
    expect(limiter.tryConsume("key", 2, 1_002)).toBe(false);
    expect(limiter.tryConsume("key", 2, 61_001)).toBe(true);
  });

  test("parses the trusted proxy list", () => {
    expect(ParseTrustedProxies("127.0.0.1, ::1 ,10.42.0.0/16,")).toEqual([
      "127.0.0.1",
      "::1",
      "10.42.0.0/16",
    ]);
    expect(ParseTrustedProxies(undefined)).toEqual([]);
    expect(ParseTrustedProxies("")).toEqual([]);
  });
});

describe("auth rate limit with trusted proxies", () => {
  async function createProbeApp(trustedProxies) {
    const app = Fastify({ trustProxy: ParseTrustedProxies(trustedProxies) });
    app.get("/probe", async (request, reply) => {
      if (!AuthRateLimit(request, request.query.username, "login")) {
        return reply.status(429).send({ ip: request.ip });
      }
      return reply.status(200).send({ ip: request.ip });
    });
    await app.ready();
    return app;
  }

  test("ignores spoofed X-Forwarded-For from an untrusted peer", async () => {
    const app = await createProbeApp("10.0.0.0/8");
    try {
      for (let index = 0; index < 30; index += 1) {
        const response = await app.inject({
          method: "GET",
          url: `/probe?username=user-${index}`,
          remoteAddress: "127.0.0.1",
          headers: { "x-forwarded-for": `198.51.100.${index}` },
        });
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body).ip).toBe("127.0.0.1");
      }
      const blocked = await app.inject({
        method: "GET",
        url: "/probe?username=user-30",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": "198.51.100.30" },
      });
      expect(blocked.statusCode).toBe(429);
      expect(JSON.parse(blocked.body).ip).toBe("127.0.0.1");
    } finally {
      await app.close();
    }
  });

  test("keys on the forwarded client when the peer is a trusted proxy", async () => {
    const app = await createProbeApp("127.0.0.1");
    try {
      for (let index = 0; index < 35; index += 1) {
        const clientIp = `203.0.113.${index}`;
        const response = await app.inject({
          method: "GET",
          url: `/probe?username=client-${index}`,
          remoteAddress: "127.0.0.1",
          headers: { "x-forwarded-for": clientIp },
        });
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body).ip).toBe(clientIp);
      }
    } finally {
      await app.close();
    }
  });
});
