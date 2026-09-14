/**
 * `@aihu/agent-server` — HMAC-SHA-256 signing for capability-bridge `invoke`
 * frames (issue #5, "WS capability-bridge has no origin check or
 * authentication").
 *
 * Uses Web Crypto (`crypto.subtle`) — a global in Node, browsers, and jsdom
 * test environments alike, no import required — the same primitive
 * `@aihu/agent-service`'s `verified-principal` tests use for real HMAC JWT
 * verification. Signing binds each `invoke` frame to the session token the
 * browser proved during its `hello` handshake (see `verifyBridgeSession` in
 * `types.ts`), so a channel that did not prove that token cannot forge an
 * invocation even if it can otherwise write frames into the browser's
 * dispatcher — the failure mode named in the issue: "a rogue WS client that
 * somehow connects still cannot drive the dispatcher".
 */

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  )
}

/**
 * The canonical payload signed for a given `invoke` frame. Both the server
 * (signing) and the client (verifying) build this identically from the same
 * three fields, independent of JSON key order elsewhere in the frame.
 */
export function bridgeSignaturePayload(
  callId: string,
  opaqueActionId: string,
  args: unknown[],
): string {
  return JSON.stringify({ callId, opaqueActionId, args })
}

/** Sign an `invoke` frame's canonical payload, keyed on the session token. */
export async function signBridgeInvoke(
  sessionToken: string,
  callId: string,
  opaqueActionId: string,
  args: unknown[],
): Promise<string> {
  const key = await hmacKey(sessionToken, ['sign'])
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(bridgeSignaturePayload(callId, opaqueActionId, args)),
  )
  return toHex(sig)
}

/**
 * Verify an `invoke` frame's signature against the session token the client
 * proved at handshake. Returns `false` (never throws) for a missing/malformed
 * `sig` so a caller can uniformly refuse to execute rather than special-case
 * verification errors.
 */
export async function verifyBridgeInvoke(
  sessionToken: string,
  callId: string,
  opaqueActionId: string,
  args: unknown[],
  sig: unknown,
): Promise<boolean> {
  if (typeof sig !== 'string' || sig.length === 0) return false
  const expected = await signBridgeInvoke(sessionToken, callId, opaqueActionId, args)
  if (expected.length !== sig.length) return false
  // Both sides are locally-computed fixed-length (32-byte) hex digests, so a
  // simple XOR-accumulate loop is a constant-time comparison in practice.
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  }
  return diff === 0
}
