/**
 * `@aihu/agent-server` — origin allowlist check for a capability-bridge
 * WebSocket upgrade (issue #5, "WS capability-bridge has no origin check or
 * authentication").
 *
 * `@aihu/agent-server` is deliberately transport-agnostic (see `BridgeChannel`
 * in `types.ts`): it never imports `ws` and never owns the raw socket or HTTP
 * upgrade, so it cannot itself inspect the `Origin` header — only the
 * consumer's own WS server sees it. This helper is the reusable, tested piece
 * of that check; wire it into the consumer's upgrade handler (e.g. `ws`'s
 * `verifyClient({ origin })`, or a Node `http` `'upgrade'` listener) so a
 * disallowed origin is refused BEFORE a `BridgeChannel` is ever constructed
 * and handed to `attachBridge` — see the README's "Securing the bridge
 * transport" section for a full wiring example.
 *
 * Fail-closed: an empty allowlist, or a missing/falsy incoming `origin`,
 * never matches. There is no wildcard-allow.
 */
export function isAllowedBridgeOrigin(
  origin: string | null | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin || allowedOrigins.length === 0) return false
  return allowedOrigins.includes(origin)
}
