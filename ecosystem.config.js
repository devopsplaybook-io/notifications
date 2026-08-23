const fs = require("fs");
let devEnv = {};
if (fs.existsSync("./env-dev.js")) {
  devEnv = require("./env-dev");
}

module.exports = {
  apps: [
    {
      name: "notifications-proxy",
      cwd: "notifications-proxy",
      script: "npm",
      args: "run start",
      autorestart: false,
      ignore_watch: ["node_modules"],
    },
    {
      name: "notifications-server",
      cwd: "notifications-server",
      script: "npm",
      args: "run dev",
      autorestart: false,
      env_development: {
        ...devEnv,
        DEV_MODE: "true",
        DATA_DIR: "../docs/dev/data",
      },
    },
    {
      name: "notifications-web",
      cwd: "notifications-web",
      script: "npm",
      args: "run dev",
      autorestart: false,
      env_development: {
        DEV_MODE: "true",
      },
    },
  ],
};
