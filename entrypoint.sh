#!/bin/sh
set -e

export APPLICATION_TITLE="${APPLICATION_TITLE:-Notifications}"

node -e '
const fs = require("fs");
const file = "/opt/app/notifications/web/manifest.json";
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
manifest.name = process.env.APPLICATION_TITLE;
manifest.short_name = process.env.APPLICATION_TITLE;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
'

exec node dist/App.js
