const fs = require("fs");
const os = require("os");
const path = require("path");

const { Config } = require("../dist/Config");

describe("session configuration", () => {
  const ENV_KEYS = ["JWT_VALIDITY_DURATION", "JWT_SESSION_MAX_DURATION"];
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

  test("environment values override the defaults", async () => {
    process.env.JWT_VALIDITY_DURATION = "3600";
    process.env.JWT_SESSION_MAX_DURATION = "7200";
    const config = newConfig();
    await config.reload();

    expect(config.JWT_VALIDITY_DURATION).toBe(3600);
    expect(config.JWT_SESSION_MAX_DURATION).toBe(7200);
  });
});
