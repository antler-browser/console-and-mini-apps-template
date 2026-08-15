# Domain setup (prerequisite for path-based hosting)

This repo hosts many mini apps on **one hostname**: the host console binds the domain
as a Cloudflare **Custom Domain** (the catch-all), and each mini app binds a
**path-based Worker Route** (`example.com/<slug>/*`) that takes precedence over it.
Both only work on a **Cloudflare zone** (a custom domain) — they do **not** work on
`*.workers.dev`. The only manual prerequisite is the zone itself.

## 1. Add the domain as a Cloudflare zone

- Register a domain (Cloudflare Registrar is simplest, or any registrar).
- In the Cloudflare dashboard: **Add a site** → enter the domain → choose a plan (Free is
  fine) → Cloudflare gives you two nameservers.
- At your registrar, set the domain's nameservers to the Cloudflare ones. Wait for the
  zone status to become **Active**.

> You can also create/manage the zone from `alchemy.run.ts` with Alchemy's `Zone`
> resource, but the nameserver change at the registrar must still be done manually.

No DNS record is needed for the hostname: deploying the host console (step 4) binds it
as a Custom Domain, and Cloudflare creates the DNS record and TLS certificate
automatically.

> **Upgrading from an older version of this template?** Earlier instructions said to add
> a dummy proxied record (`A @ 192.0.2.1`). Delete that record before deploying — an
> existing DNS record for the hostname conflicts with Custom Domain creation.

## 2. Give Alchemy's Cloudflare credentials the right permissions

Alchemy needs a `CLOUDFLARE_API_TOKEN` (and account access) with at least:

- **Workers Scripts: Edit**
- **Workers Routes: Edit** (mini apps attach path routes)
- **Zone: Read** (and **Zone: Edit** if you manage the zone via Alchemy `Zone`)
- **DNS: Edit** (Custom Domain creation writes the hostname's DNS record)

> **Multiple Cloudflare accounts?** If your credentials can see more than one account,
> Alchemy picks one arbitrarily. Set `CLOUDFLARE_ACCOUNT_ID` in `.env` to pin the target
> account — and make sure those credentials actually have access to it (`pnpm wrangler
> whoami` should list it; otherwise use a `CLOUDFLARE_API_TOKEN` scoped to that account).

## 3. Set the production origin and deploy the host

Set the real domain by editing the `ALLOWED_PRODUCTION_ORIGIN` literal in every
app's `alchemy.run.ts`, plus `templates/mini-app-starter/alchemy.run.ts` (so apps
scaffolded later inherit it).

Then deploy the host Worker:

```bash
pnpm run deploy:cloudflare
```

This deploys to a `*.workers.dev` URL (useful for a first smoke test) **and**, now that
the origin is your real domain, automatically binds `example.com` as a **Custom Domain**
on the zone from step 1 — creating the DNS record and TLS cert (cert issuance can take a
minute). While `ALLOWED_PRODUCTION_ORIGIN` is still the `your-domain.example`
placeholder, no domain is bound — you only get the workers.dev URL.

The host uses a Custom Domain (not a route) on purpose: it acts as the catch-all, and
child mini apps bind Worker Routes (`example.com/<slug>/*`), which take precedence over
a Custom Domain on the same hostname.

Verify: `dig +short example.com` should return Cloudflare IPs, and
`curl -I https://example.com/` should get a 200 from the console Worker.

## 4. Deploy child mini apps

Each mini app is a separate Worker (living at `apps/<slug>` in this workspace) that
binds its own route (`example.com/<slug>/*`). Routes take precedence over the host's
Custom Domain, so child apps override the catch-all automatically — no change to the
host is needed at request time, and no DNS work is needed because the Custom Domain
already created the hostname's record.

To make an app appear in the landing grid and the admin console, register it per
**"Register with the host console"** in
[hosting-a-mini-app.md](./hosting-a-mini-app.md) and redeploy the host.
