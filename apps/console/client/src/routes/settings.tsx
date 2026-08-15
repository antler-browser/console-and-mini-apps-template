import { useCallback, useEffect, useState } from 'react'
import {
  Onboarding,
  EditProfile,
  useOnboarding,
  getCurrentProfile,
  clearProfile,
  getFullURL,
  getPlatformDisplayName,
  type SocialLink,
} from 'local-first-auth/react'
import { decodeJWT, type LocalFirstAuth } from 'local-first-auth'
import { ImportProfile, ExportProfile } from 'local-first-auth-import-export/react'
import { Link } from 'react-router-dom'
import { AdminSection } from '../components/admin/AdminSection'
import { syncProfileToDatabase } from '../lib/userApi'

/** Theme the import/export components to match `--color-primary` in index.css. */
const authStyles = { primaryColor: '#403B51' }

/** The Local First Auth host bridge, once injected onto `window` (or undefined). */
function hostApi(): LocalFirstAuth | undefined {
  return (window as unknown as { localFirstAuth?: LocalFirstAuth }).localFirstAuth
}

/**
 * Is the user inside a native Local First Auth host (e.g. Antler)? A native host injects
 * `window.localFirstAuth` *before* the page's scripts run (Antler uses react-native-webview's
 * injectedJavaScriptBeforeContentLoaded), so a synchronous read at render is authoritative.
 *
 * Discriminator: the library injects a *web mock* onto `window` only ever alongside a
 * localStorage profile (`createProfile()` / `EditProfile`, or `useOnboarding()` when a
 * profile already exists). So an injected API with NO local profile can only be a native
 * host — this needs no `getAppDetails().platform` check and can't be fooled by one.
 */
function isNativeHost(): boolean {
  const api = hostApi()
  return api ? getCurrentProfile() === null : false
}

/** Page chrome shared by every state of the Settings screen. */
function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-12 sm:py-16">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-900"
      >
        <span aria-hidden="true">←</span> Back
      </Link>
      <header className="text-center mb-8 sm:mb-10 mt-4">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900">Settings</h1>
      </header>
      {children}
    </div>
  )
}

export function Settings() {
  // Keep useOnboarding(): it injects the web mock so web users' getProfileDetails() calls
  // (here + the admin console + profile sync) work; isLoading stays true until that injection.
  // Gating on it also holds the admin console until the API is present, fixing its own mount race.
  const { isLoading } = useOnboarding()

  if (isLoading) {
    return (
      <SettingsLayout>
        <div className="card p-10 text-center text-gray-500">Loading…</div>
      </SettingsLayout>
    )
  }

  const isNative = isNativeHost()
  return (
    <SettingsLayout>
      <ProfileSection editable={!isNative} />
      {/* Self-gating: renders nothing unless the current user is a host admin. */}
      <AdminSection />
    </SettingsLayout>
  )
}

/* ---------------------------------------------------------------------------
 * Profile — one view for web and native; only editing differs.
 * ------------------------------------------------------------------------- */

type Mode = 'view' | 'edit' | 'create' | 'import' | 'export'

/** Pull a directly-displayable avatar out of getAvatar()'s signed JWT (spec §getAvatar). */
function extractAvatar(raw: string | null): string | null {
  if (!raw) return null
  try {
    const a = (decodeJWT(raw).payload.data as { avatar?: string })?.avatar
    if (a && /^(data:|https?:)/.test(a)) return a
  } catch {
    /* not a JWT — some hosts may hand back the URL directly */
  }
  return /^(data:|https?:)/.test(raw) ? raw : null
}

/**
 * The user's own profile. The profile is read the same way for web and native — both the web
 * mock and a native host implement `getProfileDetails()` + `getAvatar()` — so only editing
 * differs:
 *  - `editable` (web): create / edit / import / export / log out against the localStorage profile.
 *  - read-only (native): the profile is owned by the host (Antler); view + Done only.
 *
 * Import and export are deliberately mutually exclusive: import is offered only when there is
 * no profile, so it can never overwrite live keys. Both are web-only — in a native host the
 * profile lives in the app (nothing to export), and importing would inject a web
 * `window.localFirstAuth` over the host's own bridge.
 */
function ProfileSection({ editable }: { editable: boolean }) {
  const [profile, setProfile] = useState<{ name: string; socials?: SocialLink[] } | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('view')
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const api = hostApi()
    setLoading(true)
    try {
      if (!api) {
        setProfile(null)
        setAvatar(null)
        return
      }
      const jwt = await api.getProfileDetails()
      setProfile(decodeJWT(jwt).payload.data as { name: string; socials?: SocialLink[] })
      setAvatar(extractAvatar(await api.getAvatar().catch(() => null)))
    } catch {
      setProfile(null)
      setAvatar(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Upsert the profile into the host D1 on every visit (idempotent server-side).
  // This is the only registration path for native hosts (Antler), whose users get
  // the read-only view and never hit the editor onComplete callbacks.
  const sync = useCallback(async () => {
    const result = await syncProfileToDatabase()
    setSyncError(result.ok ? null : result.error)
  }, [])

  useEffect(() => {
    void load()
    void sync()
  }, [load, sync])

  if (loading) {
    return <div className="card p-10 text-center text-gray-500">Loading…</div>
  }

  if (mode === 'create') {
    return (
      <div className="card p-6 sm:p-8">
        <Onboarding
          skipSocialStep={true}
          onComplete={() => {
            setMode('view')
            void sync() // best-effort upsert into the host DB
            void load()
          }}
        />
      </div>
    )
  }

  if (mode === 'edit') {
    return (
      <div className="card p-6 sm:p-8">
        <EditProfile
          onComplete={() => {
            setMode('view')
            void sync() // best-effort upsert into the host DB
            void load()
          }}
          onBack={() => setMode('view')}
        />
      </div>
    )
  }

  // Restore an existing identity from a backup file. Only reachable with no local profile,
  // so the import can never overwrite live keys.
  if (mode === 'import') {
    return (
      <div className="card p-6 sm:p-8">
        <ImportProfile
          customStyles={authStyles}
          onComplete={() => {
            setMode('view')
            void sync() // register the restored DID in the host DB
            void load()
          }}
          onBack={() => setMode('view')}
        />
      </div>
    )
  }

  // Download the profile (DID + keypair) as a portable file. ExportProfile has no onBack.
  if (mode === 'export') {
    return (
      <div className="card p-6 sm:p-8">
        <ExportProfile customStyles={authStyles} />
        <div className="flex justify-center">
          <button
            onClick={() => setMode('view')}
            className="rounded-full px-6 py-2.5 font-semibold text-gray-700 hover:bg-gray-100"
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  // Editable (web) user who hasn't created a profile yet.
  if (editable && !profile) {
    return (
      <div className="card p-10 text-center">
        <p className="text-gray-600">You don't have a profile yet.</p>
        <button onClick={() => setMode('create')} className="btn-primary mt-5 px-6 py-2.5">
          Create your profile
        </button>
        <p className="mt-4 text-sm text-gray-500">
          Already have a profile?{' '}
          <button
            onClick={() => setMode('import')}
            className="text-primary hover:text-primary-hover font-semibold underline"
          >
            Import it
          </button>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {syncError && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't sync your profile to the server ({syncError}). The admin won't see you
          until this succeeds — try reloading.
        </p>
      )}
      <section className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900">Your Profile</h2>
        <ProfileCard
          name={profile?.name ?? 'Unknown'}
          socials={profile?.socials}
          avatar={avatar}
          action={
            editable ? (
              <>
                <button
                  onClick={() => setMode('edit')}
                  className="flex w-full items-center justify-between px-6 py-4 text-left font-semibold text-gray-900 transition-colors hover:bg-gray-50 sm:px-8"
                >
                  <span>Edit profile</span>
                  <span aria-hidden="true" className="text-xl text-gray-400">
                    →
                  </span>
                </button>
                <button
                  onClick={() => setMode('export')}
                  className="flex w-full items-center justify-between border-t border-gray-200 px-6 py-4 text-left font-semibold text-gray-900 transition-colors hover:bg-gray-50 sm:px-8"
                >
                  <span>Export profile</span>
                  <span aria-hidden="true" className="text-xl text-gray-400">
                    →
                  </span>
                </button>
              </>
            ) : undefined
          }
        />
      </section>

      {editable ? (
        confirmingLogout ? (
          <div className="space-y-3 border-t border-gray-200 pt-6">
            <p className="text-gray-700">Are you sure you want to log out?</p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  clearProfile()
                  setProfile(null)
                  setAvatar(null)
                  setMode('view')
                  setConfirmingLogout(false)
                }}
                className="rounded-full px-6 py-2.5 font-semibold text-red-600 hover:bg-red-50"
              >
                Log out
              </button>
              <button
                onClick={() => setConfirmingLogout(false)}
                className="rounded-full px-6 py-2.5 font-semibold text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-gray-200 pt-6">
            <button
              onClick={() => setConfirmingLogout(true)}
              className="rounded-full px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              Log out
            </button>
          </div>
        )
      ) : (
        // Read-only native host: no Edit / Log out — the profile is owned by the host.
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <p className="text-center text-sm text-gray-500">
            Your profile lives in the Local First Auth app. To change your name, avatar, or links, edit it there.
          </p>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Shared read-only profile card.
 * ------------------------------------------------------------------------- */

function ProfileCard({
  name,
  socials,
  avatar,
  action,
}: {
  name: string
  socials?: SocialLink[]
  avatar?: string | null
  /** Optional full-width action row rendered below the identity, inside the card. */
  action?: React.ReactNode
}) {
  return (
    <div className="card overflow-hidden">
      <div className="p-6 sm:p-8">
        <div className="flex items-center gap-4">
          {avatar ? (
            <img
              src={avatar}
              alt={name}
              className="h-16 w-16 rounded-full object-cover ring-1 ring-gray-200"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-2xl text-gray-400">
              {name.charAt(0).toUpperCase() || '?'}
            </div>
          )}
          <h2 className="text-2xl font-semibold text-gray-900">{name}</h2>
        </div>

        {socials && socials.length > 0 && (
          <ul className="mt-5 space-y-2">
            {socials.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-700">
                  {getPlatformDisplayName(s.platform)}
                </span>
                <a
                  href={getFullURL(s.platform, s.handle)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary-hover underline"
                >
                  {s.handle}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {action && <div className="border-t border-gray-200">{action}</div>}
    </div>
  )
}
