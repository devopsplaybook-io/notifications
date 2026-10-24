const fs = require("fs");
const path = require("path");

function readVersion(packagePath) {
  const content = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (!content.version) {
    throw new Error(`${packagePath} has no version field`);
  }
  return content.version;
}

describe("package version consistency", () => {
  test("root, server and web versions match", () => {
    const rootVersion = readVersion(path.resolve(__dirname, "../../package.json"));
    const serverVersion = readVersion(path.resolve(__dirname, "../package.json"));
    const webVersion = readVersion(
      path.resolve(__dirname, "../../notifications-web/package.json"),
    );
    expect(serverVersion).toBe(rootVersion);
    expect(webVersion).toBe(rootVersion);
  });

  test("the server lockfile records the same version", () => {
    const rootVersion = readVersion(path.resolve(__dirname, "../../package.json"));
    const lock = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../package-lock.json"), "utf8"),
    );
    expect(lock.version).toBe(rootVersion);
  });
});
