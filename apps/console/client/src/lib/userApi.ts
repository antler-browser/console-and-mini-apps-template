/**
 * Persists the current user's own profile into the host's D1 via the public
 * `/api/add-user` + `/api/add-avatar` endpoints (the same contract child mini apps use).
 *
 * The JWTs are minted from the Local First Auth API: `getProfileDetails()` returns the
 * profile (name + socials) as a signed JWT, and `getAvatar()` returns the avatar as a
 * signed JWT or `null`. The server derives the DID from the verified signature, so a
 * caller can only ever upsert their own row.
 */
import type { LocalFirstAuth } from 'local-first-auth'

function getApi(): LocalFirstAuth | undefined {
  return (window as unknown as { localFirstAuth?: LocalFirstAuth }).localFirstAuth
}

/** Surface the server's JSON error body (e.g. a JWT `aud` mismatch) instead of a generic string. */
async function throwResponseError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
  throw new Error(body?.message ?? body?.error ?? `${fallback} (HTTP ${res.status})`)
}

async function addUserToDatabase(profileJwt: string): Promise<void> {
  const res = await fetch('/api/add-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileJwt }),
  })
  if (!res.ok) await throwResponseError(res, 'Failed to add user')
}

async function addAvatarToDatabase(avatarJwt: string): Promise<void> {
  const res = await fetch('/api/add-avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatarJwt }),
  })
  if (!res.ok) await throwResponseError(res, 'Failed to add avatar')
}

export type SyncResult = { ok: true } | { ok: false; error: string }

/**
 * Upsert the current Local First Auth profile into the host DB. Best-effort: never throws,
 * so it can't block the UI — but the outcome is reported so callers can surface failures
 * (a WebView has no visible console). Signed-out is not a failure. Avatar is optional.
 */
export async function syncProfileToDatabase(): Promise<SyncResult> {
  const api = getApi()
  if (!api) return { ok: true }
  try {
    await addUserToDatabase(await api.getProfileDetails())
    const avatarJwt = await api.getAvatar()
    if (avatarJwt) await addAvatarToDatabase(avatarJwt)
    return { ok: true }
  } catch (err) {
    console.error('Error syncing profile to database:', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
