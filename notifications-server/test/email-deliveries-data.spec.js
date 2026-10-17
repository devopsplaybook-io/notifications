jest.mock("../dist/OTelContext", () => ({
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }),
}));
jest.mock("uuid", () => {
  let counter = 0;
  return { v4: () => `mock-uuid-${(counter += 1)}` };
});

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DbUtilsInit,
  DbUtilsSetOTel,
} = require("@devopsplaybook.io/common-utils");
const {
  EmailDeliveriesList,
  EmailDeliveriesPrune,
  EmailDeliveriesRecord,
} = require("../dist/emails/EmailDeliveriesData");

const sqlDir = path.resolve(__dirname, "../sql/sqlite");
const span = undefined;

// The real DB layer requires an injected tracer/logger; a stub is enough here.
DbUtilsSetOTel(
  {
    startSpan: () => ({
      addEvent: jest.fn(),
      setAttributes: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
    }),
  },
  {
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
);

async function createDatabase() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "notifications-email-deliveries-"),
  );
  await DbUtilsInit(span, { DATABASE_TYPE: "sqlite", DATA_DIR: directory }, sqlDir);
}

function outcome(overrides = {}) {
  return {
    recipient: "user@example.com",
    notificationId: "notification-1",
    notificationTitle: "Build failed",
    source: "ci",
    severity: "error",
    status: "failed",
    attempts: 3,
    error: "smtp down",
    ...overrides,
  };
}

describe("email deliveries data (sqlite)", () => {
  beforeEach(async () => {
    await createDatabase();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("records and lists outcomes newest first", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    await EmailDeliveriesRecord(span, outcome({ notificationTitle: "First" }));
    jest.setSystemTime(new Date("2026-01-01T11:00:00.000Z"));
    await EmailDeliveriesRecord(span, outcome({ notificationTitle: "Second" }));

    const deliveries = await EmailDeliveriesList(span);
    expect(deliveries).toHaveLength(2);
    expect(deliveries[0]).toMatchObject({
      id: "mock-uuid-2",
      recipient: "user@example.com",
      notificationId: "notification-1",
      notificationTitle: "Second",
      source: "ci",
      severity: "error",
      status: "failed",
      attempts: 3,
      error: "smtp down",
      createdAt: "2026-01-01T11:00:00.000Z",
    });
    expect(deliveries[1].notificationTitle).toBe("First");
    expect(deliveries[1].createdAt).toBe("2026-01-01T10:00:00.000Z");
  });

  test("truncates long titles and errors", async () => {
    await EmailDeliveriesRecord(
      span,
      outcome({
        notificationTitle: "t".repeat(600),
        error: "e".repeat(600),
      }),
    );

    const deliveries = await EmailDeliveriesList(span);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].notificationTitle).toHaveLength(500);
    expect(deliveries[0].notificationTitle.endsWith("…")).toBe(true);
    expect(deliveries[0].error).toHaveLength(500);
  });

  test("caps the list at the 50 most recent deliveries", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    for (let i = 1; i <= 55; i += 1) {
      await EmailDeliveriesRecord(
        span,
        outcome({ notificationTitle: `Delivery ${i}` }),
      );
      jest.setSystemTime(new Date(2026, 0, 1, 0, i));
    }

    const deliveries = await EmailDeliveriesList(span);
    expect(deliveries).toHaveLength(50);
    expect(deliveries[0].notificationTitle).toBe("Delivery 55");
    expect(deliveries[49].notificationTitle).toBe("Delivery 6");
  });

  test("prunes deliveries older than the cutoff", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await EmailDeliveriesRecord(span, outcome({ notificationTitle: "Old" }));
    jest.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    await EmailDeliveriesRecord(span, outcome({ notificationTitle: "New" }));

    const deleted = await EmailDeliveriesPrune(
      span,
      "2026-03-01T00:00:00.000Z",
    );
    expect(deleted).toBe(1);

    const deliveries = await EmailDeliveriesList(span);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].notificationTitle).toBe("New");
  });

  test("prune leaves everything when nothing is older than the cutoff", async () => {
    await EmailDeliveriesRecord(span, outcome());
    await expect(
      EmailDeliveriesPrune(span, "2020-01-01T00:00:00.000Z"),
    ).resolves.toBe(0);
    await expect(EmailDeliveriesList(span)).resolves.toHaveLength(1);
  });
});
