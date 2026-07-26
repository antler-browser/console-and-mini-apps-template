/**
 * Catch-all host Worker + admin console API.
 *
 * This repo is the HOST for many independent mini apps served on one hostname via
 * Cloudflare path-based routing. This Worker is bound to the zone root (`<domain>/*`)
 * and serves the landing-grid SPA plus an SPA fallback for any path not claimed by a
 * more-specific child app Worker (static serving is handled by the `assets` binding).
 *
 * It also exposes an authed admin API (`/api/admin/*`) used by the Settings page to
 * manage users across the managed mini apps. The host holds its OWN D1 (operator
 * allowlist, gates the console) and binds each managed child app's D1 directly so it can
 * flip `users.is_admin` — see server/src/admin-apps.ts and docs/hosting-a-mini-app.md.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Context } from 'hono'
import type { Env } from './types'
import { createDb, type Database } from './db/client'
import * as UserModel from './db/models/users'
import { dbForSlug } from './admin-apps'
import { decodeAndVerifyJWT } from '@console-and-mini-apps-template/console-shared'

const app = new Hono<{ Bindings: Env }>()

/**
 * Verify a Local First Auth JWT and enforce that it was minted for our origin
 * (the ALLOWED_PRODUCTION_ORIGIN binding; unset in dev, which skips the audience
 * check).
 * local-first-auth signs with a per-origin key, so a JWT issued at another origin carries
 * a different DID and would silently create a duplicate user row.
 */
const verifyJwt = (c: Context<{ Bindings: Env }>, jwt: string) =>
  decodeAndVerifyJWT(jwt, c.env.ALLOWED_PRODUCTION_ORIGIN)

app.use('/*', cors({ origin: '*' }))

/**
 * GET /api - health check
 */
app.get('/api', (c) => c.text('😁'))

/* ---------------------------------------------------------------------------
 * Profile (the caller's own user record in the host's own D1)
 * ------------------------------------------------------------------------- */

/** POST /api/add-user — upsert the caller's profile (name + socials) into the host DB. */
app.post('/api/add-user', async (c) => {
  try {
    const { profileJwt } = await c.req.json<{ profileJwt?: string }>()
    if (!profileJwt) return c.json({ error: 'Missing profileJwt' }, 400)

    const payload = await verifyJwt(c, profileJwt)
    const did = payload.iss // cryptographically verified DID (not data.did)
    const { name, socials } = payload.data as {
      name: string
      socials?: Array<{ platform: string; handle: string }>
    }

    const user = await UserModel.addOrUpdateUser(createDb(c.env.DB), did, name, socials ?? [])
    return c.json(user)
  } catch (error) {
    console.error('Add user error:', error)
    return c.json({ error: 'Failed to add user', message: (error as Error).message }, 500)
  }
})

/** POST /api/add-avatar — upsert the caller's avatar into the host DB. */
app.post('/api/add-avatar', async (c) => {
  try {
    const { avatarJwt } = await c.req.json<{ avatarJwt?: string }>()
    if (!avatarJwt) return c.json({ error: 'Missing avatarJwt' }, 400)

    const payload = await verifyJwt(c, avatarJwt)
    const did = payload.iss
    const { avatar } = payload.data as { avatar: string }
    if (!avatar) return c.json({ error: 'No avatar data in JWT' }, 400)

    const user = await UserModel.addOrUpdateUserAvatar(createDb(c.env.DB), did, avatar)
    return c.json(user)
  } catch (error) {
    console.error('Add avatar error:', error)
    return c.json({ error: 'Failed to add avatar', message: (error as Error).message }, 500)
  }
})

/* ---------------------------------------------------------------------------
 * Admin console
 * ------------------------------------------------------------------------- */

/**
 * Is this DID allowed to use the admin console? True if flagged `is_admin` in the host's own D1.
 */
async function isHostAdmin(env: Env, did: string): Promise<boolean> {
  try {
    return await UserModel.isUserAdmin(createDb(env.DB), did)
  } catch {
    return false
  }
}

/**
 * Verify the caller's JWT and that they're a host admin. Returns the verified DID, or a
 * Response to short-circuit the handler (401/403).
 */
async function requireHostAdmin(
  c: Context<{ Bindings: Env }>
): Promise<{ did: string } | Response> {
  const jwt = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!jwt) return c.json({ error: 'Unauthorized' }, 401)
  let did: string
  try {
    did = (await verifyJwt(c, jwt)).iss
  } catch (err) {
    return c.json({ error: 'Invalid token', message: (err as Error).message }, 401)
  }
  if (await isHostAdmin(c.env, did)) return { did }
  return c.json({ error: 'Forbidden' }, 403)
}

/**
 * Read a route param the route pattern guarantees. adminAction handlers aren't tied
 * to a literal path, so Hono's generic Context types params `string | undefined`.
 */
function requiredParam(c: Context<{ Bindings: Env }>, name: string): string {
  const value = c.req.param(name)
  if (value === undefined) throw new Error(`Missing route param :${name}`)
  return value
}

/**
 * Wrap an admin action on a managed child app's D1: enforce admin auth, resolve the
 * `:slug` to its child database, run the action, and normalize errors. Each handler
 * receives a Drizzle client for the child DB and the request context.
 */
function adminAction(
  handler: (db: Database, c: Context<{ Bindings: Env }>) => Promise<unknown>
) {
  return async (c: Context<{ Bindings: Env }>) => {
    const auth = await requireHostAdmin(c)
    if (auth instanceof Response) return auth

    const child = dbForSlug(c.env, requiredParam(c, 'slug'))
    if (!child) return c.json({ error: 'Unknown app' }, 404)

    try {
      const result = await handler(createDb(child), c)
      return c.json((result as object) ?? { success: true })
    } catch (err) {
      return c.json({ error: 'Admin action failed', message: (err as Error).message }, 500)
    }
  }
}

/**
 * GET /api/admin/status - whether the caller may use the admin console. Used by the
 * client to decide whether to render the Settings → Admin section. Never errors on a
 * missing/invalid token; just reports `isAdmin: false`.
 */
app.get('/api/admin/status', async (c) => {
  const jwt = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!jwt) return c.json({ isAdmin: false })
  try {
    const { iss } = await verifyJwt(c, jwt)
    return c.json({ isAdmin: await isHostAdmin(c.env, iss) })
  } catch {
    return c.json({ isAdmin: false })
  }
})

/** GET /api/admin/apps/:slug/users - list the app's users. */
app.get(
  '/api/admin/apps/:slug/users',
  adminAction(async (db) => ({ users: await UserModel.getAllUsers(db) }))
)

/** POST /api/admin/apps/:slug/users/:did/grant-admin - make a user an admin of the app. */
app.post(
  '/api/admin/apps/:slug/users/:did/grant-admin',
  adminAction(async (db, c) => {
    await UserModel.setUserAdmin(db, requiredParam(c, 'did'), true)
  })
)

/** POST /api/admin/apps/:slug/users/:did/revoke-admin - revoke a user's admin. */
app.post(
  '/api/admin/apps/:slug/users/:did/revoke-admin',
  adminAction(async (db, c) => {
    await UserModel.setUserAdmin(db, requiredParam(c, 'did'), false)
  })
)

/** DELETE /api/admin/apps/:slug/users/:did - remove a user from the app. */
app.delete(
  '/api/admin/apps/:slug/users/:did',
  adminAction(async (db, c) => {
    await UserModel.deleteUserByDID(db, requiredParam(c, 'did'))
  })
)

/**
 * POST /api/admin/apps/:slug/users/:did/block - block a user.
 * Requires the child app's `users` table to have a `blocked` column; otherwise this
 * returns a 500 whose message surfaces to the UI (see docs/hosting-a-mini-app.md).
 */
app.post(
  '/api/admin/apps/:slug/users/:did/block',
  adminAction(async (db, c) => {
    await UserModel.setUserBlocked(db, requiredParam(c, 'did'), true)
  })
)

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx)
  },
}
