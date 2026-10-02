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
| `GET /api/status` | none | `{ "started": true }` |
| `GET /api/users/status/initialization` | none | `{ "initialized": boolean }`; always 200; initial setup only |
| `POST /api/users` | none, first account only | `{ "name": string, "password": string }`; blocked after bootstrap |
| `POST /api/users/session` | none or existing session | `{ "name": string, "password": string }`; returns `{ "success": true, "token": string }`. Requests with a valid session renew the token without consuming the login rate limit. |
| `POST /api/users/logout` | `Bearer <session>` | Revokes **all** sessions of the user (bumps the token version) |
| `PUT /api/users/password` | `Bearer <session>` | `{ "passwordOld": string, "password": string }`; revokes other sessions and returns a fresh `token` for the current one |
| `GET /api/tokens` | `Bearer <session>` | Returns token names and dates, never token values |
| `POST /api/tokens` | `Bearer <session>` | `{ "name": string }`; the generated token is returned once |
| `DELETE /api/tokens/:id` | `Bearer <session>` | Revokes an API token; unknown IDs return 404 |
| `GET /api/notifications` | session or `Bearer <API token>` | `limit` (1-200, default 50), `offset` (non-negative), `source`, `read` (`all`, `read`, `unread`); returns `{ "notifications": [], "total": number }` |
| `GET /api/notifications/sources` | session or API token | Returns `{ "sources": string[] }` |
| `POST /api/notifications` | API token | Requires `title`; optional `body`, `source`, `severity`, and object-valued `data`. `data` may also be a JSON-encoded object string. `body` is capped at 10 KB and serialized `data` at 4 KB (both UTF-8); larger payloads return 400. |
| `PUT /api/notifications/:id/read` | `Bearer <session>` | `{ "read": boolean }`; unknown IDs return 404 |
| `PUT /api/notifications/read-all` | `Bearer <session>` | Optional `source` and `read` filters |
| `DELETE /api/notifications/:id` | `Bearer <session>` | Unknown IDs return 404 |
| `DELETE /api/notifications` | `Bearer <session>` | Deletes all deployment-wide notifications |
| `GET /api/push/publickey` | none | Returns the Web Push VAPID public key |
| `POST /api/push/subscribe` | `Bearer <session>` | `{ "subscription": PushSubscriptionJSON }`; endpoint and encryption keys are validated; re-subscribing an endpoint updates it in place |
| `DELETE /api/push/subscribe` | `Bearer <session>` | `{ "endpoint": "https://..." }`; removes the browser's stored subscription |

Missing or malformed API credentials are rejected with 401 (403 is only returned for policy denials such as closed registration or a wrong old password on a password change). Invalid notification fields and push subscriptions return 400; internal 5xx details are not returned to clients.

Push fan-out is asynchronous: `POST /api/notifications` enqueues the notification and returns immediately; a background in-memory queue delivers it with up to 3 attempts (exponential backoff, five-second timeout per send, ten concurrent sends). Delivery is best-effort: queued items are lost if the pod restarts (single replica, `Recreate` strategy). Push payloads are bounded — the title is truncated at 200 characters and the body at 1000 (with an ellipsis), the `data` object is not pushed, and the notification click opens the app which loads the full record from the API. Expired 404/410 subscriptions are pruned; deliveries that exhaust their retries are logged and counted in the `push.failures` metric.

## Single-tenant setup and security

Create the initial account once through `/users`; account creation closes after the first user is stored. Notifications and read state are deployment-wide, not user-specific. All sessions share notification visibility, read state, delete permissions and API-token management. Do not expose additional accounts as isolated users; this deployment intentionally has a single administrator-equivalent account.

Configure `JWT_KEY` with at least 32 characters. The service fails at startup if it is missing or weak. The key is read from the environment only and is never stored in the database (migration `init-0005` purges the legacy `metadata.auth_token` copy). Rotating `JWT_KEY` and restarting the service invalidates all existing sessions; clients simply log in again. Browser CORS is restricted to `https://notifications.didierhoarau.cloud`; API-token clients that do not use browsers are unaffected. Login and registration are throttled by client IP and username; token refreshes with a valid session are exempt. Sessions are bound to a per-user `tokenVersion`: changing the password or calling `/api/users/logout` revokes all of the user's sessions (tokens issued before this migration carry no version claim and count as version 0, so existing sessions stay valid until revoked). Security response headers are applied by the API, including a Content-Security-Policy that allows only same-origin resources plus the inline scripts and styles required by the static Nuxt build.

The runtime container runs as the non-root `node` user (uid 1000). Writable paths (`/data` for SQLite and backups, the web manifest rewritten from `APPLICATION_TITLE`) must be owned by uid 1000; when the volume was created by an older root-running image, run a one-off `chown -R 1000:1000 /data` (e.g. `kubectl exec`) before deploying this version, and after a PVC restore.

API token values are stored as SHA-256 hashes. The version 0.8.0 migration tags existing plaintext values before startup converts them to hashes. Existing integrations keep using their original token values; clients do not need to rotate during this migration. Newly created tokens are displayed only once. Back up the database before upgrading. An old application image cannot authenticate against the migrated token hashes, so rollback requires restoring the pre-upgrade database or rotating/reissuing integrations' tokens.

## Retention and SQLite operations

Notifications are pruned on startup and daily after 90 days. Set `NOTIFICATION_RETENTION_DAYS` to a positive integer to change the age; set it to `0` to disable pruning. The value must be a non-negative integer: an invalid value at startup aborts the boot, and an invalid value after a config reload is ignored (the previous known-good value is kept and a warning is logged) so a misconfiguration can neither mass-delete notifications nor crash the pruning timer. SQLite/Postgres migrations add indexes for source and read-state filtering. Read state remains shared across the deployment.

SQLite uses the default delete journal mode and an explicit 5-second busy timeout; WAL is intentionally not enabled because the deployment uses a single RWO database volume and snapshot backups. The application uses SQLite's online backup API on startup and every six hours to atomically refresh `/data/database.db.backup`. The existing Restic sidecar snapshots `/data`, including this consistent backup image. The SQLite migration and online-backup integrity check are covered by tests.

Before applying the schema/token migration, deploy the GitOps change that uses a `Recreate` strategy for the single-replica SQLite deployment. Do not run overlapping application pods against the volume. For a PVC restore, stop the application, restore the Restic snapshot, and use `database.db.backup` as the authoritative consistent database image if integrity-checking the live `database.db` fails. Retain the snapshot backup when changing or restoring SQLite journal settings.

## Development

```bash
cd notifications-server && npm ci && npm run build && npm run lint && npm test
cd ../notifications-web && npm ci && npm run build && npm run lint && npm test
```

## License

MIT
