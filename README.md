# Notifications

Centralized notification service for the DevOpsPlaybook.io ecosystem.

## Features

- Fastify API for notification producers and consumers
- Single-tenant web UI with shared read state and push notifications
- API tokens for integrations and JWT sessions for the web UI
- Configurable 90-day notification retention

## Architecture

- `notifications-server/` — Fastify backend, SQLite/Postgres persistence and OpenTelemetry
- `notifications-web/` — Nuxt single-page app and push service worker
- `notifications-proxy/` — Traefik reverse proxy for development

## API

All API routes are under `/api`. JSON routes accept and return JSON.

| Method and path | Authentication | Contract |
| --- | --- | --- |
| `GET /status` | none | `{ "started": true }` |
| `GET /users/status/initialization` | none | `{ "initialized": boolean }`; initial setup only |
| `POST /users` | none, first account only | `{ "name": string, "password": string }`; blocked after bootstrap |
| `POST /users/session` | none or existing session | `{ "name": string, "password": string }`; returns `{ "success": true, "token": string }` |
| `PUT /users/password` | `Bearer <session>` | `{ "passwordOld": string, "password": string }` |
| `GET /tokens` | `Bearer <session>` | Returns token names and dates, never token values |
| `POST /tokens` | `Bearer <session>` | `{ "name": string }`; the generated token is returned once |
| `DELETE /tokens/:id` | `Bearer <session>` | Revokes an API token |
| `GET /notifications` | session or `Bearer <API token>` | `limit` (1-200, default 50), `offset` (non-negative), `source`, `read` (`all`, `read`, `unread`); returns `{ "notifications": [], "total": number }` |
| `GET /notifications/sources` | session or API token | Returns `{ "sources": string[] }` |
| `POST /notifications` | API token | Requires `title`; optional `body`, `source`, `severity`, and object-valued `data`. `data` may also be a JSON-encoded object string. |
| `PUT /notifications/:id/read` | `Bearer <session>` | `{ "read": boolean }`; unknown IDs return 404 |
| `PUT /notifications/read-all` | `Bearer <session>` | Optional `source` and `read` filters |
| `DELETE /notifications/:id` | `Bearer <session>` | Unknown IDs return 404 |
| `DELETE /notifications` | `Bearer <session>` | Deletes all deployment-wide notifications |
| `GET /push/publickey` | none | Returns the Web Push VAPID public key |
| `POST /push/subscribe` | `Bearer <session>` | `{ "subscription": PushSubscriptionJSON }`; endpoint and encryption keys are validated |
| `DELETE /push/subscribe` | `Bearer <session>` | `{ "endpoint": "https://..." }`; removes the browser's stored subscription |

Missing or malformed API credentials are rejected. Invalid notification fields and push subscriptions return 400; internal 5xx details are not returned to clients. Push delivery is synchronous but each send has a five-second timeout and the fan-out is limited to ten concurrent sends. Expired 404/410 subscriptions are pruned; other failures are logged and counted.

## Single-tenant setup and security

Create the initial account once through `/users`; account creation closes after the first user is stored. Notifications and read state are deployment-wide, not user-specific. All sessions share notification visibility, read state, delete permissions and API-token management. Do not expose additional accounts as isolated users; this deployment intentionally has a single administrator-equivalent account.

Configure `JWT_KEY` with at least 32 characters. The service fails at startup if it is missing or weak. Browser CORS is restricted to `https://notifications.didierhoarau.cloud`; API-token clients that do not use browsers are unaffected. Login and registration are throttled by client IP and username. Security response headers are applied by the API.

API token values are stored as SHA-256 hashes. The version 0.8.0 migration tags existing plaintext values before startup converts them to hashes. Existing integrations keep using their original token values; clients do not need to rotate during this migration. Newly created tokens are displayed only once. Back up the database before upgrading. An old application image cannot authenticate against the migrated token hashes, so rollback requires restoring the pre-upgrade database or rotating/reissuing integrations' tokens.

## Retention and SQLite operations

Notifications are pruned on startup and daily after 90 days. Set `NOTIFICATION_RETENTION_DAYS` to a positive integer to change the age; set it to `0` to disable pruning. SQLite/Postgres migrations add indexes for source and read-state filtering. Read state remains shared across the deployment.

SQLite uses the default delete journal mode and an explicit 5-second busy timeout; WAL is intentionally not enabled because the deployment uses a single RWO database volume and snapshot backups. The application uses SQLite's online backup API on startup and every six hours to atomically refresh `/data/database.db.backup`. The existing Restic sidecar snapshots `/data`, including this consistent backup image. The SQLite migration and online-backup integrity check are covered by tests.

Before applying the schema/token migration, deploy the GitOps change that uses a `Recreate` strategy for the single-replica SQLite deployment. Do not run overlapping application pods against the volume. For a PVC restore, stop the application, restore the Restic snapshot, and use `database.db.backup` as the authoritative consistent database image if integrity-checking the live `database.db` fails. Retain the snapshot backup when changing or restoring SQLite journal settings.

## Development

```bash
cd notifications-server && npm ci && npm run build && npm run lint && npm test
cd ../notifications-web && npm ci && npm run build && npm run lint && npm test
```

## License

MIT
