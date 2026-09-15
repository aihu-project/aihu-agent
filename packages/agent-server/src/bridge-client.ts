/**
 * `@aihu/agent-server` — browser capability-bridge client (T3).
 *
 * Runs in the browser, alongside the REAL, visible component. It registers the
 * compiler-emitted `__agentDispatcher` (opaque-ID → invoker maps; carries no
 * scope/rateLimit/policy) and executes server-approved invocations against the
 * on-screen instance — so the component the user sees is the one actually
 * driven, not an invisible server twin.
 *
 * Wire protocol: see `./types.ts`. The server sends `{ type:'invoke', callId,
 * opaqueActionId, args }` ONLY after its security gate authorizes the call; this
 * client replies with `{ type:'result' }` / `{ type:'error' }` and (when a
 * snapshot source is provided) a `{ type:'snapshot' }` reflecting the visible
 * instance's new state.
 */

import { verifyBridgeInvoke } from './bridge-sig.ts'
import type { BridgeChannel, BridgeServerMessage } from './types.ts'
import { BRIDGE_PROTOCOL_VERSION } from './types.ts'

/**
 * The compiler-emitted `__agentDispatcher` shape (client artifact, T1). Opaque
 * IDs key concrete invokers on the visible component. Contains NO policy info —
 * the server is the sole policy authority.
 */
export interface AgentDispatcher {
  readonly tag: string
  /** opaqueId → action invoker (called with the positional args array). */
  readonly actions: Record<string, (args: unknown[]) => unknown>
  /** opaqueId → read accessor (current signal value). */
  readonly reads: Record<string, () => unknown>
  /** opaqueId → write accessor. */
  readonly writes: Record<string, (value: unknown) => void>
}

export interface BridgeClientOptions {
  /** The compiler-emitted `__agentDispatcher` for the mounted component. */
  dispatcher: AgentDispatcher
  /** Duplex channel to the server (a `ws` WebSocket in production). */
  channel: BridgeChannel
  /**
   * Optional snapshot source (e.g. the mount's `serialize`). When provided, a
   * `snapshot` frame is pushed after each successful invocation so the server
   * and any read-only viewer reflect the visible instance's new state.
   */
  serialize?: () => unknown
  /**
   * Session credential proving this client's identity to a server built with
   * `AgentServerOptions.verifyBridgeSession` (issue #5). Sent in the initial
   * `hello` frame. When set, every `invoke` frame's `sig` MUST verify against
   * this same token (via `verifyBridgeInvoke`) before its action runs — an
   * `invoke` with a missing or mismatched signature is refused with a loud
   * `error` reply rather than executed, so a channel that never proved this
   * token cannot drive the dispatcher even if it can otherwise write frames
   * into it. Omit this to keep the pre-existing, protocol-only handshake
   * (backward compatible: no signature is required or checked).
   */
  sessionToken?: string
}

/** A running bridge client. */
export interface BridgeClient {
  /** Stop handling frames. Does not close the underlying channel. */
  dispose(): void
}

/**
 * Start a browser bridge client. Sends the `hello` handshake immediately, then
 * handles `invoke` frames by executing the opaque action on the visible
 * component and replying with the result.
 */
export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  const { dispatcher, channel } = options

  function send(msg: unknown): void {
    if (channel.connected) channel.send(JSON.stringify(msg))
  }

  // Handshake — lets the server reject an incompatible protocol version, and
  // (when configured) proves this client's session token up front.
  send({
    type: 'hello',
    protocol: BRIDGE_PROTOCOL_VERSION,
    ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
  })

  async function handleInvoke(
    callId: string,
    opaqueActionId: string,
    args: unknown[],
    sig: unknown,
  ): Promise<void> {
    // A signing session: refuse to execute anything whose signature doesn't
    // verify against the SAME token this client proved at handshake. This is
    // independent of whatever verified this channel at the transport level —
    // a rogue writer into this channel still cannot drive the dispatcher
    // without also knowing the token.
    if (options.sessionToken) {
      const ok = await verifyBridgeInvoke(options.sessionToken, callId, opaqueActionId, args, sig)
      if (!ok) {
        send({
          type: 'error',
          callId,
          message: 'BRIDGE_SIG_INVALID: invoke signature did not verify against the session token',
        })
        return
      }
    }
    // Prefer an action; fall back to a read accessor (read+write share an
    // opaque id, and the v1 invoke frame has no op discriminator — args-less
    // reads resolve here, writes-over-bridge are intentionally not yet wired).
    const action = dispatcher.actions[opaqueActionId]
    const read = action ? undefined : dispatcher.reads[opaqueActionId]
    if (!action && !read) {
      // Loud desync, not a silent drop (plan §"Failure modes" — opaque-ID drift).
      send({ type: 'error', callId, message: `no action: ${opaqueActionId}` })
      return
    }
    try {
      const result = action ? await action(args) : read!()
      send({ type: 'result', callId, result: result ?? null })
      if (options.serialize) {
        send({ type: 'snapshot', callId, snapshot: options.serialize() })
      }
    } catch (err) {
      send({ type: 'error', callId, message: err instanceof Error ? err.message : String(err) })
    }
  }

  const offMessage = channel.onMessage((data) => {
    let msg: BridgeServerMessage
    try {
      msg = JSON.parse(data) as BridgeServerMessage
    } catch {
      return // ignore malformed frames
    }
    if (msg.type !== 'invoke') return
    void handleInvoke(msg.callId, msg.opaqueActionId, msg.args, msg.sig)
  })

  const offClose = channel.onClose(() => {
    /* The server rejects its own pending calls on close; nothing to do here. */
  })

  return {
    dispose(): void {
      offMessage()
      offClose()
    },
  }
}
