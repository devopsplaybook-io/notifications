const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const entrypoint = path.resolve(__dirname, "../../entrypoint.sh");

function prepare(directory, initialName) {
  const script = fs
    .readFileSync(entrypoint, "utf8")
    .split("/opt/app/notifications")
    .join(directory);
  const scriptPath = path.join(directory, "entrypoint.sh");
  fs.writeFileSync(scriptPath, script);
  fs.chmodSync(scriptPath, 0o755);
  fs.mkdirSync(path.join(directory, "web"), { recursive: true });
  fs.mkdirSync(path.join(directory, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "web", "manifest.json"),
    JSON.stringify(
      {
        name: initialName,
        short_name: initialName,
        description: "Centralized notification service",
        icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(path.join(directory, "dist", "App.js"), "process.exit(0);\n");
}

function runEntryScript(directory, title) {
  const childEnv = { ...process.env };
  delete childEnv.APPLICATION_TITLE;
  if (title !== undefined) {
    childEnv.APPLICATION_TITLE = title;
  }
  execFileSync("sh", [path.join(directory, "entrypoint.sh")], {
    cwd: directory,
    env: childEnv,
    stdio: "pipe",
  });
  return JSON.parse(
    fs.readFileSync(path.join(directory, "web", "manifest.json"), "utf8"),
  );
}

describe("entrypoint.sh", () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "notifications-entry-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("defaults the manifest title when APPLICATION_TITLE is unset", () => {
    prepare(directory, "Stale title");
    const manifest = runEntryScript(directory);
    expect(manifest.name).toBe("Notifications");
    expect(manifest.short_name).toBe("Notifications");
    expect(manifest.description).toBe("Centralized notification service");
    expect(manifest.icons).toHaveLength(1);
  });

  test("uses APPLICATION_TITLE when set", () => {
    prepare(directory, "Stale title");
    const manifest = runEntryScript(directory, "Custom App");
    expect(manifest.name).toBe("Custom App");
    expect(manifest.short_name).toBe("Custom App");
    expect(manifest.description).toBe("Centralized notification service");
    expect(manifest.icons).toHaveLength(1);
  });

  test("falls back to the default title when APPLICATION_TITLE is empty", () => {
    prepare(directory, "Stale title");
    const manifest = runEntryScript(directory, "");
    expect(manifest.name).toBe("Notifications");
    expect(manifest.short_name).toBe("Notifications");
    expect(manifest.description).toBe("Centralized notification service");
    expect(manifest.icons).toHaveLength(1);
  });
});
