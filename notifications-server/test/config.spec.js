const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  AuthSessionPolicyCheck,
  AuthSessionPolicyLog,
} = require("@devopsplaybook.io/common-utils");

const { Config } = require("../dist/Config");

describe("session configuration", () => {
  const ENV_KEYS = [
    "JWT_VALIDITY_DURATION",
    "JWT_SESSION_MAX_DURATION",
    "LOGIN_CODE_ENABLED",
  ];
  const savedEnv = {};
  let tmpDir;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notifications-config-"));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function newConfig() {
    const config = new Config();
    config.CONFIG_FILE = path.join(tmpDir, "config.json");
    return config;
  }

  test("reload keeps the 30-day validity and 90-day cap", async () => {
    const config = newConfig();
    await config.reload();

    expect(config.JWT_VALIDITY_DURATION).toBe(2592000);
    expect(config.JWT_SESSION_MAX_DURATION).toBe(7776000);
  });

  test("reload does not restore a library default after the values were used", async () => {
    const config = newConfig();
    await config.reload();
    await config.reload();

    expect(config.JWT_VALIDITY_DURATION).toBe(2592000);
    expect(config.JWT_SESSION_MAX_DURATION).toBe(7776000);
  });

  test("matches the documented auth session policy", async () => {
    const config = newConfig();
    await config.reload();

    const result = AuthSessionPolicyCheck(config, { app: "notifications" });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("logs the intended values and the policy line at startup", async () => {
    const config = newConfig();
    const lines = [];
    await config.reload((message) => lines.push(message));
    AuthSessionPolicyLog(config, {
      app: "notifications",
      logger: (message) => lines.push(message),
    });

    expect(lines).toContain(
      "Configuration Value: JWT_VALIDITY_DURATION: 2592000 (from defaults)",
    );
    expect(lines).toContain(
      "Configuration Value: JWT_SESSION_MAX_DURATION: 7776000 (from defaults)",
    );
    expect(lines).toContain(
      "Auth session policy: app=notifications validity=2592000s cap=7776000s renewal=sliding status=ok",
    );
  });

  test("reports an error line for a regressed configuration", async () => {
    process.env.JWT_VALIDITY_DURATION = "60";
    const config = newConfig();
    const lines = [];
    await config.reload();
    const result = AuthSessionPolicyLog(config, {
      app: "notifications",
      logger: (message) => lines.push(message),
    });

    expect(result.ok).toBe(false);
    expect(lines[0]).toContain("status=error");
    expect(lines.some((line) => line.startsWith("Auth session policy error:"))).toBe(
      true,
    );
  });

  test("environment values override the defaults", async () => {
    process.env.JWT_VALIDITY_DURATION = "3600";
    process.env.JWT_SESSION_MAX_DURATION = "7200";
    const config = newConfig();
    await config.reload();

    expect(config.JWT_VALIDITY_DURATION).toBe(3600);
    expect(config.JWT_SESSION_MAX_DURATION).toBe(7200);
  });

  test("LOGIN_CODE_ENABLED defaults to off and follows the environment", async () => {
    const config = newConfig();
    await config.reload();
    expect(config.LOGIN_CODE_ENABLED).toBe(false);

    process.env.LOGIN_CODE_ENABLED = "true";
    const enabled = newConfig();
    await enabled.reload();
    expect(enabled.LOGIN_CODE_ENABLED).toBe(true);
  });
});
