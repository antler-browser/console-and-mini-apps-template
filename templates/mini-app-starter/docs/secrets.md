# Secrets & environment variables

How this app manages configuration in local dev and production. Every value falls into
one of three buckets — put it in the right bucket and everything else follows.

## The three buckets

The sorting rule: **does the value differ between local dev and prod?**

| Bucket | Examples | Local dev source | Prod source | Committed? |
|---|---|---|---|---|
| **Infra/deploy creds** | `ALCHEMY_STATE_TOKEN`, `ALCHEMY_PASSWORD`, `ALCHEMY_STAGE`, `CLOUDFLARE_ACCOUNT_ID` | n/a (never reach the app runtime) | `.env`, read by `alchemy deploy` | No — `.env` is gitignored |
| **Env-invariant runtime values** (same value locally and in prod — secrets AND non-secrets, e.g. an API key, an account id, a bucket name) | `MY_SECRET`, `R2_ACCOUNT_ID` | `.env`, injected into `c.env` via `[secrets] required` in wrangler.toml | binding in alchemy.run.ts, seeded from `.env` at deploy: `alchemy.secret.env.X` for secrets, `alchemy.env.X` for non-secrets — both throw if the var is unset | No — `.env` only |
| **Env-varying non-secrets** (different value locally vs prod) | `ALLOWED_PRODUCTION_ORIGIN` | committed literal in wrangler.toml `[vars]` if dev needs one (`ALLOWED_PRODUCTION_ORIGIN` is deliberately unset in dev — the JWT audience check is skipped) | committed literal in alchemy.run.ts | Yes — both files |

`ALCHEMY_STATE_TOKEN` is a secret you invent yourself (not fetched from any service):
it guards the small state Worker Alchemy deploys to your Cloudflare account. **One
token per account** — every Alchemy project deploying there must use the same value,
so reuse an existing one rather than generating a second.

Why env-varying values must be committed literals and **never route through `.env`**:
`alchemy deploy` loads `.env`, so a local deploy would push your localhost values
(e.g. localhost origins) to prod. A value can only live in `.env` if it is safe for
the *same* string to reach both local dev and production.

(Secrets are env-invariant by definition here: one secret value serves both. If you
ever need a dev-only secret distinct from prod's, that's the signal to split into a
separate `.env` key that only alchemy.run.ts reads.)

## One env file: `.env`

There is a single, gitignored `.env` (copy `.env.example` and fill it in — inside the
console workspace, `pnpm new-app` seeds it from `apps/console/.env`). Two tools
read it at two different times:

| Consumer | When | Reads |
|---|---|---|
| `alchemy deploy` (Node) | deploy time | infra creds + env-invariant runtime values (to seed Worker bindings) |
| `wrangler dev` | local runtime | **only** the keys listed in `[secrets] required` |

The `[secrets]` gate in `wrangler.toml` keeps deploy creds out of the app runtime:
only listed keys are injected into `c.env` (as strings). A missing key logs
`Missing required secrets: ...` — dev stays runnable.

Gotchas (wrangler ≥ 4.77):

- **Never create a `.dev.vars` file.** If one exists, `wrangler dev` ignores `.env`
  entirely and this whole model breaks.
- With a `[secrets]` block present, wrangler also merges in your **shell environment**
  (shell wins over `.env`), and a shell/`.env` key that collides with a `[vars]` name
  overrides the committed dev var. Don't export app var names in your shell.
- Wrangler also reads `.env.local` and `.env.<environment>` variants if present.

## Adding a new secret

1. Add `MY_SECRET=` to `.env` and `.env.example`.
2. Add it to `[secrets] required` in `wrangler.toml` (local dev).
3. Bind it in `alchemy.run.ts`: `MY_SECRET: alchemy.secret.env.MY_SECRET` — this
   throws at deploy time if the var is missing from `.env`, so a deploy fails loud
   instead of shipping without it. In prod it becomes a Worker secret (`secret_text`).
4. Add `MY_SECRET?: string` to the `Env` interface in `server/src/types.ts`.

An env-invariant **non-secret** (account id, bucket name) follows the exact same four
steps, except step 3 uses `alchemy.env.MY_VALUE` — same fail-loud behavior, but bound
as a plain var instead of a secret.

The first secret also requires `ALCHEMY_PASSWORD` in `.env` (and the `password:`
option in `alchemy.run.ts`, already wired): Alchemy encrypts secret values with it
before persisting them to the state store. A deploy with any secret **aborts** if it
is unset (`Cannot serialize secret without password`). Keep it **stable across
deploys** — changing it leaves Alchemy unable to decrypt previously-stored secrets.

## Deploy safety

- `.env` sets `ALCHEMY_STAGE=prod`, so `pnpm deploy:cloudflare` from your machine
  targets **production**.
- `pnpm alchemy run` is a read-only preflight: it executes `alchemy.run.ts` without
  touching infra, so it verifies `.env` has every required value (each
  `alchemy.secret.env.X` throws on a gap) before you deploy for real.
- Rotating a secret: update it in `.env`, redeploy. Verify in the Cloudflare
  dashboard → your Worker → Settings → Variables and Secrets.
- In CI there is no `.env`; set the same variables as CI environment variables —
  both `alchemy deploy` and `alchemy.secret.env` read `process.env` either way.
