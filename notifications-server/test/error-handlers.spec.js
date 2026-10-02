const mockLogError = jest.fn();
jest.mock("../dist/OTelContext", () => ({
  OTelRequestSpan: () => undefined,
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: mockLogError,
    }),
  }),
}));

const Fastify = require("fastify");
const {
  RegisterErrorHandler,
  RegisterNotFoundHandler,
} = require("../dist/ErrorHandlers");

describe("error handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("does not reply again when the response already started", () => {
    let handler;
    RegisterErrorHandler({
      setErrorHandler: (registered) => {
        handler = registered;
      },
    });
    const headersSentReply = {
      raw: { headersSent: true },
      sent: false,
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    handler(new Error("failure after response started"), {}, headersSentReply);
    expect(mockLogError).toHaveBeenCalledWith(
      "Unhandled API error after response started",
      expect.any(Error),
      undefined,
    );
    expect(headersSentReply.status).not.toHaveBeenCalled();
    expect(headersSentReply.send).not.toHaveBeenCalled();

    const alreadySentReply = {
      raw: { headersSent: false },
      sent: true,
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    handler(new Error("failure after reply sent"), {}, alreadySentReply);
    expect(alreadySentReply.send).not.toHaveBeenCalled();
  });

  test("returns client errors with their status code and 500 otherwise", async () => {
    const app = Fastify();
    RegisterErrorHandler(app);
    app.get("/bad-request", async () => {
      throw Object.assign(new Error("Bad input"), { statusCode: 400 });
    });
    app.get("/crash", async () => {
      throw new Error("unexpected");
    });
    await app.ready();
    try {
      const badRequest = await app.inject({
        method: "GET",
        url: "/bad-request",
      });
      expect(badRequest.statusCode).toBe(400);
      expect(JSON.parse(badRequest.body)).toEqual({ error: "Bad input" });

      const crash = await app.inject({ method: "GET", url: "/crash" });
      expect(crash.statusCode).toBe(500);
      expect(JSON.parse(crash.body)).toEqual({ error: "Internal Server Error" });
      expect(mockLogError).toHaveBeenCalledWith(
        "Unhandled API error",
        expect.any(Error),
        undefined,
      );
    } finally {
      await app.close();
    }
  });

  test("serves the SPA fallback and JSON 404s without double replies", async () => {
    const app = Fastify();
    app.decorateReply("sendFile", function () {
      return this.send("<html>app</html>");
    });
    RegisterNotFoundHandler(app);
    await app.ready();
    try {
      const spaRoute = await app.inject({ method: "GET", url: "/dashboard" });
      expect(spaRoute.statusCode).toBe(200);
      expect(spaRoute.body).toContain("app");

      const apiRoute = await app.inject({ method: "GET", url: "/api/missing" });
      expect(apiRoute.statusCode).toBe(404);
      expect(JSON.parse(apiRoute.body)).toEqual({ error: "Not Found" });

      const fileRoute = await app.inject({ method: "GET", url: "/missing.js" });
      expect(fileRoute.statusCode).toBe(404);
      expect(JSON.parse(fileRoute.body)).toEqual({ error: "Not Found" });
    } finally {
      await app.close();
    }
  });
});
