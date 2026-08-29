# BUILD
FROM node:26-alpine as builder

WORKDIR /opt/src

RUN apk add --no-cache bash git python3 perl alpine-sdk

COPY notifications-server notifications-server

RUN cd notifications-server && \
    npm ci && \
    npm run build

COPY notifications-web notifications-web

RUN cd notifications-web && \
    npm ci && \
    npm run generate

# RUN
FROM node:26-alpine

COPY entrypoint.sh /entrypoint.sh

COPY --from=builder /opt/src/notifications-server/node_modules /opt/app/notifications/node_modules
COPY --from=builder /opt/src/notifications-server/dist /opt/app/notifications/dist
COPY --from=builder /opt/src/notifications-web/.output/public /opt/app/notifications/web
COPY notifications-server/config.json /opt/app/notifications/config.json
COPY notifications-server/sql /opt/app/notifications/sql
COPY package.json /opt/app/notifications/package.json

WORKDIR /opt/app/notifications

ENTRYPOINT [ "/entrypoint.sh" ]
