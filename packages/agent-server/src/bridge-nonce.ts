/**
 * `@aihu/agent-server` — single-use, short-lived nonces for capability-bridge
 * handshake binding (issue #13, follow-up to #5's origin/session-token checks).
 *
 * `isAllowedBridgeOrigin` (`bridge-origin.ts`) answers "which page may attach"
 * and `verifyBridgeSession` (`types.ts`/`agent-server.ts`) answers "which
 * session may attach" — neither stops a captured/replayed `hello` from the
 * SAME origin and session being sent again (a stale tab, a duplicated
 * handshake frame, a second concurrent attach). A nonce closes that gap: the
 * server issues one for a single upcoming handshake, the client echoes it back
 * in `hello`, and it is consumed exactly once — a replay of the same nonce
 * value fails the second time even though the session token it accompanies is
 * still otherwise valid.
 *
 * Deliberately in-memory and per-`createAgentServer`-instance, mirroring the
 * package's existing no-external-runtime-deps posture (see `bridge-sig.ts`'s
 * docblock) — a multi-instance deployment needing shared nonce state is out of
 * scope here, same as this package owning no session store.
 */

/** A nonce issued for one upcoming bridge handshake. */
export interface BridgeNonce {
  /** Opaque single-use token; the client echoes this back in `hello.nonce`. */
  readonly nonce: string
  /** Epoch ms after which `consume` refuses this nonce even if unused. */
  readonly expiresAt: number
}

/** Issues and consumes single-use bridge handshake nonces. */
export interface BridgeNonceStore {
  /** Issue a new single-use nonce, valid for `ttlMs` (default 30s). */
  issue(ttlMs?: number): BridgeNonce
  /**
   * Consume `nonce`: returns `true` at most ONCE per value ever issued by
   * this store, and only before its expiry. Every other input — an unknown
   * value, a replay, an expired nonce, or a non-string — returns `false`.
   * Never throws.
   */
  consume(nonce: unknown): boolean
}

const DEFAULT_TTL_MS = 30_000

/** Create a fresh, empty in-memory nonce store. */
export function createBridgeNonceStore(): BridgeNonceStore {
  const live = new Map<string, number>() // nonce -> expiresAt (epoch ms)

  function sweepExpired(now: number): void {
    for (const [n, expiresAt] of live) {
      if (expiresAt <= now) live.delete(n)
    }
  }

  return {
    issue(ttlMs = DEFAULT_TTL_MS): BridgeNonce {
      const now = Date.now()
      sweepExpired(now)
      const nonce = crypto.randomUUID()
      const expiresAt = now + ttlMs
      live.set(nonce, expiresAt)
      return { nonce, expiresAt }
    },
    consume(nonce: unknown): boolean {
      if (typeof nonce !== 'string' || nonce === '') return false
      const expiresAt = live.get(nonce)
      if (expiresAt === undefined) return false
      // Single-use: remove on first consult regardless of outcome, so a
      // replay of an expired nonce also correctly fails (it is gone either
      // way) rather than lingering in the map until the next sweep.
      live.delete(nonce)
      return expiresAt > Date.now()
    },
  }
}
