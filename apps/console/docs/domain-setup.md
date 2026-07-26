# Domain setup (prerequisite for path-based hosting)

This repo hosts many mini apps on **one hostname** using Cloudflare **path-based Worker
routes** (most-specific path wins). Route patterns only work on a **Cloudflare zone**
(a custom domain) — they do **not** work on `*.workers.dev`. So before routing can work
you need a domain in Cloudflare with a proxied DNS record.

## 1. Add the domain as a Cloudflare zone

- Register a domain (Cloudflare Registrar is simplest, or any registrar).
- In the Cloudflare dashboard: **Add a site** → enter the domain → choose a plan (Free is
  fine) → Cloudflare gives you two nameservers.
- At your registrar, set the domain's nameservers to the Cloudflare ones. Wait for the
  zone status to become **Active**.

> You can also create/manage the zone from `alchemy.run.ts` with Alchemy's `Zone`
> resource, but the nameserver change at the registrar must still be done manually.

## 2. Add a proxied DNS record for the hostname

**Route patterns only activate when a proxied (orange-cloud) DNS record exists for the
host.** The Worker replaces the origin, so the record just needs to resolve and be proxied:

- Type `A`, Name `@`, IPv4 `192.0.2.1` (a reserved "dummy" address), **Proxy status: Proxied**.
  - (Or `AAAA @ 100::`, proxied.)
- Add a proxied record for `www` too if you want `www` covered.

## 3. Give Alchemy's Cloudflare credentials the right permissions

Alchemy needs a `CLOUDFLARE_API_TOKEN` (and account access) with at least:

- **Workers Scripts: Edit**
- **Workers Routes: Edit**
- **Zone: Read** (and **Zone: Edit** if you manage the zone via Alchemy `Zone`)
- **DNS: Edit** (if you manage DNS records via Alchemy)

> **Multiple Cloudflare accounts?** If your credentials can see more than one account,
> Alchemy picks one arbitrarily. Set `CLOUDFLARE_ACCOUNT_ID` in `.env` to pin the target
> account — and make sure those credentials actually have access to it (`pnpm wrangler
> whoami` should list it; otherwise use a `CLOUDFLARE_API_TOKEN` scoped to that account).

## 4. Set the production origin and deploy the host

Set the real domain by editing the `ALLOWED_PRODUCTION_ORIGIN` literal in every
app's `alchemy.run.ts`, plus `templates/mini-app-starter/alchemy.run.ts` (so apps
scaffolded later inherit it).

Then deploy the host Worker:

```bash
pnpm run deploy:cloudflare
```

This deploys to a `*.workers.dev` URL (useful for a first smoke test) **and**, now that
the origin is your real domain, automatically attaches the `example.com/*` catch-all
route to the zone from step 1. While `ALLOWED_PRODUCTION_ORIGIN` is still the
`your-domain.example` placeholder, no route is attached — you only get the workers.dev
URL.

This is a Worker **Route** (the `example.com/*` pattern), not a "Custom Domain" — child
mini apps bind more-specific routes (`example.com/<slug>/*`) that must win over this
catch-all.

## 5. Deploy child mini apps

Each mini app is a separate Worker (living at `apps/<slug>` in this workspace) that
binds its own, more-specific routes (`example.com/<slug>` and `example.com/<slug>/*`).
Because most-specific wins, those override the host's `example.com/*` automatically —
no change to the host is needed at request time.

To make an app appear in the landing grid and the admin console, register it per
**"Register with the host console"** in
[hosting-a-mini-app.md](./hosting-a-mini-app.md) and redeploy the host.
