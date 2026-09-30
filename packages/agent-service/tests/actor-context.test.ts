/**
 * aihu-agent#17 (aihu#870) — tenant-aware actor context: `resolveActor`.
 *
 * Acceptance criteria under test:
 *   - valid claims + a configured `ActorLookup` resolve to the correct
 *     `Actor` shape;
 *   - a caller-supplied `organizationId` has no path into the result (the
 *     function accepts no such parameter at all);
 *   - a missing `ActorLookup` fails closed (denies), never
 *     ANONYMOUS-with-full-access;
 *   - each `ActorKind` round-trips.
 */

import { describe, expect, it } from 'vitest'
import type { ActorLookup, ActorLookupResult, Principal } from '../src/principal-gate.ts'
import { resolveActor } from '../src/principal-gate.ts'
import type { AuthPlugin, VerifiedClaims } from '../src/types.ts'
import { resolvePrincipal } from '../src/principal-gate.ts'

// ─── Real HMAC-SHA-256 JWT helpers (same discipline as principal-gate.test.ts) ───

const SECRET = 'actor-context-test-secret-32-bytes-ok!!'

async function hmacKey(usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  )
}

async function signJwt(claims: Record<string, unknown>): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const input = `${header}.${payload}`
  const key = await hmacKey(['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input))
  return `${input}.${Buffer.from(sig).toString('base64url')}`
}

function realHmacAuthPlugin(): AuthPlugin {
  const decode = (jwt: string): Record<string, unknown> | null => {
    const parts = jwt.split('.')
    if (parts.length !== 3 || !parts[1]) return null
    try {
      const obj = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown
      return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
        ? (obj as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  return {
    checkScope: () => false,
    async verify(jwt: string): Promise<VerifiedClaims | null> {
      try {
        const parts = jwt.split('.')
        if (parts.length !== 3) return null
        const [h, p, s] = parts as [string, string, string]
        const key = await hmacKey(['verify'])
        const sigBytes = Buffer.from(s, 'base64url')
        const sig = new Uint8Array(new ArrayBuffer(sigBytes.length))
        sigBytes.copy(sig as unknown as Buffer)
        const ok = await crypto.subtle.verify(
          'HMAC',
          key,
          sig,
          new TextEncoder().encode(`${h}.${p}`),
        )
        if (!ok) return null
        return decode(jwt) as VerifiedClaims | null
      } catch {
        return null
      }
    },
  }
}

/** A fixed-answer `ActorLookup` stub — the "current, authoritative lookup". */
function fixedLookup(result: ActorLookupResult | null): ActorLookup {
  return { resolve: () => result }
}

async function verifiedAgent(claims: Record<string, unknown>): Promise<Principal> {
  const jwt = await signJwt(claims)
  return resolvePrincipal({ jwt }, { authPlugin: realHmacAuthPlugin() })
}

describe('resolveActor — fail-closed posture', () => {
  it('no ActorLookup configured → denies (no-actor-lookup), never full access', async () => {
    const principal = await verifiedAgent({ sub: 'agent-1', scope: 'reports:read' })
    const resolution = await resolveActor(principal, {})
    expect(resolution).toEqual({ ok: false, reason: 'no-actor-lookup' })
  })

  it('anonymous principal → denies (anonymous-principal), lookup never consulted', async () => {
    const principal = await resolvePrincipal({}, { authPlugin: realHmacAuthPlugin() })
    expect(principal.class).toBe('anonymous')
    let consulted = false
    const lookup: ActorLookup = {
      resolve: () => {
        consulted = true
        return { kind: 'machine', organizationId: 'org-1' }
      },
    }
    const resolution = await resolveActor(principal, { actorLookup: lookup })
    expect(resolution).toEqual({ ok: false, reason: 'anonymous-principal' })
    expect(consulted).toBe(false)
  })

  it('lookup finds no current grant (null) → denies (lookup-denied)', async () => {
    const principal = await verifiedAgent({ sub: 'agent-1', scope: 'reports:read' })
    const resolution = await resolveActor(principal, { actorLookup: fixedLookup(null) })
    expect(resolution).toEqual({ ok: false, reason: 'lookup-denied' })
  })
})

describe('resolveActor — valid resolution shape', () => {
  it('resolves the full Actor shape from claims + the lookup result', async () => {
    const principal = await verifiedAgent({
      sub: 'agent-42',
      scope: 'reports:read',
      iss: 'https://issuer.example',
      aud: 'https://api.example',
    })
    const lookup = fixedLookup({
      kind: 'delegated-agent',
      organizationId: 'org-acme',
      grantId: 'grant-1',
      grantVersion: 'v3',
    })
    const resolution = await resolveActor(principal, { actorLookup: lookup })
    expect(resolution).toEqual({
      ok: true,
      actor: {
        kind: 'delegated-agent',
        subject: 'agent-42',
        organizationId: 'org-acme',
        scopes: ['reports:read'],
        issuer: 'https://issuer.example',
        audience: 'https://api.example',
        grantId: 'grant-1',
        grantVersion: 'v3',
      },
    })
  })

  it('lookup scopes override the principal scopes when provided', async () => {
    const principal = await verifiedAgent({ sub: 'agent-1', scope: 'reports:read' })
    const lookup = fixedLookup({
      kind: 'machine',
      organizationId: 'org-1',
      scopes: ['tenant:reports:read', 'tenant:reports:write'],
    })
    const resolution = await resolveActor(principal, { actorLookup: lookup })
    expect(resolution.ok).toBe(true)
    if (resolution.ok) {
      expect(resolution.actor.scopes).toEqual(['tenant:reports:read', 'tenant:reports:write'])
    }
  })

  it('missing grant/claims fields resolve to null, not undefined or a caller default', async () => {
    const principal = await verifiedAgent({ sub: 'agent-1' })
    const lookup = fixedLookup({ kind: 'machine', organizationId: 'org-1' })
    const resolution = await resolveActor(principal, { actorLookup: lookup })
    expect(resolution.ok).toBe(true)
    if (resolution.ok) {
      expect(resolution.actor.issuer).toBeNull()
      expect(resolution.actor.audience).toBeNull()
      expect(resolution.actor.grantId).toBeNull()
      expect(resolution.actor.grantVersion).toBeNull()
    }
  })

  it.each(['human', 'delegated-agent', 'machine'] as const)(
    'ActorKind %s round-trips through resolveActor',
    async (kind) => {
      const principal = await verifiedAgent({ sub: 'agent-1' })
      const lookup = fixedLookup({ kind, organizationId: 'org-1' })
      const resolution = await resolveActor(principal, { actorLookup: lookup })
      expect(resolution).toEqual({
        ok: true,
        actor: expect.objectContaining({ kind }),
      })
    },
  )

  it('a human-session principal resolves with null issuer/audience (no raw claims)', async () => {
    const principal: Principal = { class: 'human-session', sub: 'user-1', scopes: ['read'] }
    const lookup = fixedLookup({ kind: 'human', organizationId: 'org-1' })
    const resolution = await resolveActor(principal, { actorLookup: lookup })
    expect(resolution).toEqual({
      ok: true,
      actor: {
        kind: 'human',
        subject: 'user-1',
        organizationId: 'org-1',
        scopes: ['read'],
        issuer: null,
        audience: null,
        grantId: null,
        grantVersion: null,
      },
    })
  })
})

describe('resolveActor — caller-supplied organizationId has no path in', () => {
  it('resolveActor accepts no organizationId parameter at all', async () => {
    const principal = await verifiedAgent({ sub: 'agent-1' })
    const lookup = fixedLookup({ kind: 'machine', organizationId: 'org-authoritative' })
    // A caller cannot smuggle an organizationId into resolveActor's inputs —
    // its signature is (principal, { actorLookup }); there is no field for
    // it. Simulate a host that (incorrectly) tried to carry one on the
    // principal/claims anyway, and confirm it is never read.
    const tampered = {
      ...principal,
      organizationId: 'org-attacker-supplied',
    } as unknown as Principal
    const resolution = await resolveActor(tampered, { actorLookup: lookup })
    expect(resolution.ok).toBe(true)
    if (resolution.ok) {
      expect(resolution.actor.organizationId).toBe('org-authoritative')
    }
  })

  it('the lookup itself sees only the principal + claims, never a raw request', async () => {
    let sawOrganizationId: unknown
    const lookup: ActorLookup = {
      resolve: (principal) => {
        sawOrganizationId = (principal as unknown as { organizationId?: unknown }).organizationId
        return { kind: 'machine', organizationId: 'org-authoritative' }
      },
    }
    const principal = await verifiedAgent({ sub: 'agent-1' })
    await resolveActor(principal, { actorLookup: lookup })
    expect(sawOrganizationId).toBeUndefined()
  })
})
