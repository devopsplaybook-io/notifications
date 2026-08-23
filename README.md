# Notifications

Centralized notification service for the DevOpsPlaybook.io ecosystem.

## Features

- **Notification API**: Define API where notifications can be sent from other applications
- **API Token Authentication**: Secure API access with configurable tokens
- **User Login**: Users can login and see past notifications (newest first)
- **PWA Push Notifications**: Device notifications when a new notification is received

## Architecture

- `notifications-server/` — Fastify backend with OpenTelemetry instrumentation
- `notifications-web/` — Nuxt 3 SPA with PWA support
- `notifications-proxy/` — Traefik reverse proxy for development

## Development

```bash
npm run dev
```

## License

MIT
