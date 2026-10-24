# Notifications

Centralized notification service for the DevOpsPlaybook.io ecosystem.

## Features

- Fastify API for notification producers and consumers
- Single-tenant web UI with shared read state and push notifications
- API tokens for integrations and JWT sessions for the web UI
- Live feed: the unread badge polls every 60 s and the list refreshes automatically on tab focus/visibility change
- Frictionless sign-in: unauthenticated visitors get the login form directly on `/` and return to the notifications after signing in; the browser tab title shows the unread count (e.g. `(3) Notifications`)
- Push device management: Settings → Devices lists every subscribed browser (origin, user agent, subscribe date) with per-device revoke so a lost browser can be cut off remotely
- Search and filtering: case-insensitive text search over title/body, severity filter, source filter with per-source unread counts in the source dropdown
- Notification cards render the `data` payload as key/value details (URLs become links), show relative timestamps and expose an "Open" action for embedded URLs
- Deep links (`/?notification=<id>`) highlight, expand and mark the notification read; push taps land on the exact notification
- Configurable 90-day notification retention
- Consolidated Settings page (account, change password, theme, API keys, email rules)
- Email notification rules with SMTP configuration from environment variables
- Producer onboarding: creating an API key shows a copyable `curl` example (real instance URL, sample payload) and a "Send test notification" action that validates the token end-to-end from the browser
- Email delivery feedback: recent per-recipient delivery outcomes (sent/failed, attempts, last error) are visible under Settings → Email; queue-full and SMTP-not-configured drops are recorded as failures
- Severity threshold matching for email rules ("warning and above", "error and above"); exact match remains the default

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
| `POST /api/users` | none, first account only | `{ "name": string, "password": string }`; blocked after bootstrap. `name` is trimmed and capped at 100 characters |
| `POST /api/users/session` | none or existing session | `{ "name": string, "password": string }`; returns `{ "success": true, "token": string }`. Requests with a valid session renew the token without consuming the login rate limit. |
| `POST /api/users/logout` | `Bearer <session>` | Revokes **all** sessions of the user (bumps the token version) |
| `PUT /api/users/password` | `Bearer <session>` | `{ "passwordOld": string, "password": string }`; revokes other sessions and returns a fresh `token` for the current one |
| `GET /api/tokens` | `Bearer <session>` | Returns token names and dates, never token values |
| `POST /api/tokens` | `Bearer <session>` | `{ "name": string }`; trimmed and capped at 200 characters; the generated token is returned once |
| `DELETE /api/tokens/:id` | `Bearer <session>` | Revokes an API token; unknown IDs return 404 |
| `GET /api/notifications` | session or `Bearer <API token>` | `limit` (1-200, default 50), `offset` (non-negative), `source`, `read` (`all`, `read`, `unread`), `severity` (case-insensitive exact match), `q` (case-insensitive substring on title/body, LIKE wildcards escaped); returns `{ "notifications": [], "total": number }` |
| `GET /api/notifications/sources` | session or API token | Returns `{ "sources": string[], "unreadCounts": { [source]: number } }` (unread counts are global, not affected by filters) |
| `GET /api/notifications/:id` | session or API token | Returns the notification; unknown IDs return 404 |
| `POST /api/notifications` | API token | Requires `title`; optional `body`, `source`, `severity`, and object-valued `data`. `data` may also be a JSON-encoded object string. `body` is capped at 10 KB and serialized `data` at 4 KB (both UTF-8); larger payloads return 400. |
| `PUT /api/notifications/:id/read` | `Bearer <session>` | `{ "read": boolean }`; unknown IDs return 404 |
| `PUT /api/notifications/read-all` | `Bearer <session>` | Optional `source`, `read`, `severity` and `q` filters |
| `DELETE /api/notifications/:id` | `Bearer <session>` | Unknown IDs return 404 |
| `DELETE /api/notifications` | `Bearer <session>` | Deletes notifications matching the optional `source`, `read`, `severity` and `q` filters (no filters = all) |
| `GET /api/push/publickey` | none | Returns the Web Push VAPID public key |
| `POST /api/push/subscribe` | `Bearer <session>` | `{ "subscription": PushSubscriptionJSON }`; endpoint and encryption keys are validated; re-subscribing an endpoint updates it in place and refreshes the stored user agent while keeping the original subscribe date |
| `DELETE /api/push/subscribe` | `Bearer <session>` | `{ "endpoint": "https://..." }`; removes the browser's stored subscription |
| `GET /api/push/subscriptions` | `Bearer <session>` | Returns `{ "subscriptions": [] }`; each entry is `{ "id", "endpointOrigin", "userAgent", "createdAt", "endpointHash" }` of the session user's devices (the full endpoint, which contains capability tokens, is never returned) |
| `DELETE /api/push/subscriptions/:id` | `Bearer <session>` | Revokes a push device by id; unknown or not-owned IDs return 404 |
| `GET /api/emails/rules` | `Bearer <session>` | Returns `{ "rules": [] }`; each rule is `{ "id", "source", "severity", "severityMode", "recipient", "createdAt" }` |
| `POST /api/emails/rules` | `Bearer <session>` | `{ "recipient": string }`; optional `source`, `severity` (empty or omitted = wildcard) and `severityMode` (`exact`, default, or `threshold` — matches the rule severity and everything above it in the `info < success < warning < error` escalation order; unknown severities never satisfy a threshold). Returns the created rule |
| `PUT /api/emails/rules/:id` | `Bearer <session>` | Same payload as creation; unknown IDs return 404 |
| `DELETE /api/emails/rules/:id` | `Bearer <session>` | Removes the rule; unknown IDs return 404 |
| `GET /api/emails/deliveries` | `Bearer <session>` | Returns `{ "deliveries": [] }`; the most recent 50 per-recipient delivery outcomes `{ "id", "recipient", "notificationId", "notificationTitle", "source", "severity", "status" ("sent"/"failed"), "attempts", "error", "createdAt" }`, pruned with the notification retention |
| `GET /api/emails/status` | `Bearer <session>` | Returns `{ "smtpConfigured": boolean }` |
| `POST /api/emails/test` | `Bearer <session>` | `{ "recipient": string }`; sends a test email, 502 on SMTP failure or timeout; limited to 5 requests per minute per user session (429 beyond) |

Missing or malformed API credentials are rejected with 401 (403 is only returned for policy denials such as closed registration or a wrong old password on a password change). Invalid notification fields and push subscriptions return 400; internal 5xx details are not returned to clients.

Push fan-out is asynchronous: `POST /api/notifications` enqueues the notification and returns immediately; a background in-memory queue delivers it with up to 3 attempts (exponential backoff, five-second timeout per send, ten concurrent sends). Delivery is best-effort: queued items are lost if the pod restarts (single replica, `Recreate` strategy). Push payloads are bounded — the title is truncated at 200 characters and the body at 1000 (with an ellipsis), the `data` object is not pushed, and the notification click opens the deep link `/?notification=<id>`, which fetches the full record, highlights and expands the card and marks the notification read. Expired 404/410 subscriptions are pruned; deliveries that exhaust their retries are logged and counted in the `push.failures` metric.

## Email notification rules

Email rules email a new notification to a recipient when its source ("service") and severity match the rule. Each rule selects a service, a severity and a recipient; an empty service and/or severity acts as a wildcard (for example "all errors from any service" or "everything from fluxcd"). Matching is case-insensitive; by default severities are compared exactly, and a rule saved with `severityMode: "threshold"` matches its severity and everything above it in the `info < success < warning < error` escalation order (so "warning and above" catches warnings and errors without creating two exact rules; unknown producer severities never satisfy a threshold). Several rules can point at the same recipient, in which case the notification is emailed once per recipient. Rules are evaluated at creation time only: no retroactive emails are sent for notifications stored before the rule.

Delivery follows the same best-effort pattern as push: a background in-memory queue with up to 3 attempts (exponential backoff, ten-second timeout per send, three concurrent sends); evaluation or delivery failures never fail the `POST /api/notifications` call and deliveries that exhaust their retries are counted in the `email.failures` metric. Each attempt is bounded to ten seconds: the SMTP connection, greeting and socket timeouts are configured on the transport, and a send that times out is recorded as `failed` and is **not retried automatically** because the server may already have accepted the message; the queue worker only moves on once the send has actually settled. Queued emails are lost if the pod restarts. The HTML part of the email renders the notification body as markdown (GitHub-flavored with line breaks, the same rendering as the web UI) and sanitizes it with an allowlist: no scripts, styles or event handlers survive and links are restricted to http/https/mailto. The title, severity and source remain escaped plain text, and the plain-text part contains the raw markdown body.

The SMTP configuration comes from environment variables and is never stored in the database nor returned by the API:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SMTP_HOST` | empty | SMTP server host; empty disables the email feature (rules keep working, nothing is sent) |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | `true` for implicit TLS (port 465); `false` upgrades with STARTTLS |
| `SMTP_USER` | empty | SMTP user; empty disables authentication |
| `SMTP_PASSWORD` | empty | SMTP password (sensitive) |
| `SMTP_FROM` | empty | From address; required together with `SMTP_HOST` for deliveries |
| `APP_PUBLIC_URL` | `https://notifications.didierhoarau.cloud` | Link included in the email body |

Rules, the SMTP status, the recent delivery log (sent/failed outcomes with attempts and errors, answering "why didn't I get an email?") and a "send test email" action are managed in the web UI under Settings → Email. Test-email sends are recorded in the same log.

## Single-tenant setup and security

Create the initial account once through Settings → Profile (`/users` and `/tokens` redirect to their new Settings locations); account creation closes after the first user is stored. The web UI navigation has a Notifications entry and a single Settings entry with Profile (account, change password, theme), Devices (push subscription management), API Keys and Email tabs. Notifications and read state are deployment-wide, not user-specific. All sessions share notification visibility, read state, delete permissions and API-token management. Do not expose additional accounts as isolated users; this deployment intentionally has a single administrator-equivalent account.

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
