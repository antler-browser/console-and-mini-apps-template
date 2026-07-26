# Admin Setup

There are two kinds of admin in this repo:

1. **Host console operators** — who may use the Settings → Admin section to manage users
   across mini apps. Gated by the **host's own** D1 (`is_admin` in its `users` table)
2. **Per-app admins** — a user flagged `is_admin` in a specific mini app's D1. Operators
   set these from the host console (or via SQL on that app's DB).

```bash
# Dev (local host D1)
pnpm wrangler d1 execute console-and-mini-apps-template-dev-db --local --command "UPDATE users SET is_admin = 1 WHERE did = 'did:key:z...';"

# Production (remote host D1)
pnpm wrangler d1 execute console-and-mini-apps-template-prod-db --remote --command "UPDATE users SET is_admin = 1 WHERE did = 'did:key:z...';"
```

Once a DID is a host operator, the Settings → Admin section appears for them and they can
grant/revoke admin (and block/remove) users on each managed app.

## Set a per-app admin directly (without the console)

Each mini app stores `is_admin` in its own `users` table:

```bash
# Dev (local). Replace with the real DB name from `pnpm wrangler d1 list`.
pnpm wrangler d1 execute check-in-dev-db --local --command "UPDATE users SET is_admin = 1 WHERE did = 'did:key:z...';"

# Production (remote)
pnpm wrangler d1 execute check-in-prod-db --remote --command "UPDATE users SET is_admin = 1 WHERE did = 'did:key:z...';"
```

> **How the console reaches each app's D1:** the host Worker binds each managed app's
> D1 directly, driven by the `MANAGED_APPS` registry in `shared/src/apps.ts` (the D1
> UUID is the sync point; `alchemy.run.ts` and `server/src/admin-apps.ts` both derive
> from the registry). This requires every app to live in the same pinned Cloudflare
> account. See [`docs/hosting-a-mini-app.md`](./hosting-a-mini-app.md).
