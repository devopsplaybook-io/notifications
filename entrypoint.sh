#!/bin/sh

if [ "${APPLICATION_TITLE}" == "" ]; then
  APPLICATION_TITLE="Notifications"
fi

sed -i "s/APPLICATION_TITLE/$APPLICATION_TITLE/g" /opt/app/notifications/web/manifest.webmanifest

node dist/App.js
