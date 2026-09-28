/**
 * Conformance suite (aihu-agent#14, routed from aihu-project/aihu#874) — the
 * `@aihu/agent-server` half of the regression floor described in the
 * `@aihu/agent-service` conformance suite (`packages/agent-service/tests/
 * conformance.test.ts`). Read that file's header first; this one covers only
 * what is specific to this package: the capability-bridge origin/handshake
 * posture.
 *
 * Covers:
 *  1. The exported API surface and dependency-version contract this package
 *     is pinned against.
 *  2. `isAllowedBridgeOrigin` fails closed by default (empty allowlist,
 *     missing origin) — pinned through the public export.
 *  3. A capability-bridge channel that reconnects after the previous one
 *     disconnected must independently prove its own session; a verified
 *     handshake is never inherited by a new channel.
 *
 * NOT covered here: revoking an already-verified, STILL-CONNECTED channel
 * mid-session (no reconnect involved) is not yet implemented anywhere in
 * this package — see `bridge-sig.ts`'s docblock (`invoke` frames are signed
 * with the session token proved at handshake, not re-verified against a
 * live session store per call) and aihu-agent#13, which is the issue for
 * that gap. Do not read part 3 as proof that a revoked-but-still-connected
 * session is cut off — it is not.
 */

import { registerAgentMetadata } from '@aihu/agent'
import { type AgentBindingSpec, branch, leaf } from '@aihu/arbor'
import { type Signal, signal } from '@aihu/signals'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as agentServerIndex from '../src/index.ts'
import { createAgentServer } from '../src/agent-server.ts'
import { isAllowedBridgeOrigin } from '../src/bridge-origin.ts'
import type { AgentServer, BridgeChannel } from '../src/types.ts'
import { BRIDGE_PROTOCOL_VERSION } from '../src/types.ts'
import agentServerPackageJson from '../package.json' with { type: 'json' }

// ─── Part 1: pinned package versions + exported API surface ─────────────────

describe('conformance — pinned package versions and API surface', () => {
  it("@aihu/agent-server's own runtime dependency contract is unchanged", () => {
    expect(agentServerPackageJson.dependencies).toEqual({
      '@aihu/agent': '^0.2.1',
      '@aihu/agent-service': '^0.4.1',
      '@aihu/arbor': '^4.1.2',
      '@modelcontextprotocol/sdk': '^1.0.0',
      jsdom: '^25.0.0',
    })
  })

  it('the exported value surface matches the documented allowlist exactly', () => {
    const exportedValues = Object.keys(agentServerIndex).sort()
    expect(exportedValues).toEqual(
      [
        'BRIDGE_PROTOCOL_VERSION',
        'createAgentServer',
        'createBridgeClient',
        'isAllowedBridgeOrigin',
        'bridgeSignaturePayload',
        'signBridgeInvoke',
        'verifyBridgeInvoke',
        'createComponentMcpServer',
        'serveComponentMcp',
        'opaqueActionId',
        'opaqueActionIdForTool',
        'parseToolName',
      ].sort(),
    )
  })

  it('the WS capability-bridge protocol version is unchanged (a bump is a breaking wire change)', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(1)
  })
})

// ─── Part 2: origin allowlist fails closed by default ────────────────────────

describe('conformance — isAllowedBridgeOrigin fails closed', () => {
  it('an empty allowlist matches nothing, even a plausible-looking origin', () => {
    expect(isAllowedBridgeOrigin('https://app.example.com', [])).toBe(false)
  })

  it('a missing/null origin never matches, even against a non-empty allowlist', () => {
    expect(isAllowedBridgeOrigin(null, ['https://app.example.com'])).toBe(false)
    expect(isAllowedBridgeOrigin(undefined, ['https://app.example.com'])).toBe(false)
    expect(isAllowedBridgeOrigin('', ['https://app.example.com'])).toBe(false)
  })
})

// ─── Part 3: a reconnecting bridge channel proves its own session ───────────

const TAG = 'conformance-counter'

function makeCounter(): { node: ReturnType<typeof branch>; agentBinding: AgentBindingSpec } {
  const [count, setCount] = signal(0)
  const countSig = [count, setCount] as unknown as Signal<string>
  const node = branch('div', { id: TAG }, [leaf(countSig)])
  const agentBinding: AgentBindingSpec = {
    tag: TAG,
    actions: {
      increment: (args: unknown) => {
        const by = Array.isArray(args) && typeof args[0] === 'number' ? args[0] : 1
        setCount(count() + by)
        return count()
      },
    },
    reads: { count: () => count() },
    writes: { count: (v: unknown) => setCount(Number(v)) },
  }
  return { node, agentBinding }
}

function host(): Element {
  return new JSDOM('<!DOCTYPE html><body></body>').window.document.body
}

beforeEach(() => {
  registerAgentMetadata({
    tag: TAG,
    describes: 'A counter used by the conformance suite.',
    actions: { increment: { returns: {} } },
    state: { count: 'The current counter value.' },
  })
})

let servers: AgentServer[] = []
afterEach(() => {
  for (const s of servers) s.dispose()
  servers = []
})

function spawn(...args: Parameters<typeof createAgentServer>): AgentServer {
  const s = createAgentServer(...args)
  servers.push(s)
  return s
}

/** A fake bridge channel whose close can be triggered, mirroring bridge-auth.test.ts. */
function makeFakeBridge(onSend: (data: string) => void): BridgeChannel & {
  reply(data: string): void
  close(): void
} {
  let msgHandler: ((d: string) => void) | null = null
  let closeHandler: (() => void) | null = null
  let open = true
  return {
    get connected() {
      return open
    },
    send(data: string) {
      onSend(data)
    },
    onMessage(h) {
      msgHandler = h
      return () => {
        msgHandler = null
      }
    },
    onClose(h) {
      closeHandler = h
      return () => {
        closeHandler = null
      }
    },
    reply(data: string) {
      msgHandler?.(data)
    },
    close() {
      open = false
      closeHandler?.()
    },
  }
}

describe('conformance — a reconnected bridge channel must independently re-verify', () => {
  it('after the verified channel disconnects, a new channel that skips hello is never delegated to', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
      verifyBridgeSession: (token) => token === 'good-token',
    })

    // First connection: proves its session and would be delegated to.
    const first = makeFakeBridge(() => {})
    server.attachBridge(first)
    first.reply(
      JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL_VERSION, sessionToken: 'good-token' }),
    )
    await Promise.resolve()
    await Promise.resolve()
    first.close()

    // Reconnect: a new channel attaches after the disconnect. Even though a
    // channel for this same logical peer was already verified once, the new
    // channel must prove ITS OWN session — nothing about the prior verified
    // state carries over to it.
    const sent: string[] = []
    const reconnected = makeFakeBridge((d) => sent.push(d))
    server.attachBridge(reconnected) // no `hello` sent this time

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
    }
    expect(res.code).toBe(503)
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })

  it('a reconnected channel presenting a stale/invalid token is rejected, not grandfathered in', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
      verifyBridgeSession: (token) => token === 'good-token',
    })

    const first = makeFakeBridge(() => {})
    server.attachBridge(first)
    first.reply(
      JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL_VERSION, sessionToken: 'good-token' }),
    )
    await Promise.resolve()
    await Promise.resolve()
    first.close()

    const sent: string[] = []
    const reconnected = makeFakeBridge((d) => sent.push(d))
    server.attachBridge(reconnected)
    reconnected.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        sessionToken: 'stale-token',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
    }
    expect(res.code).toBe(503)
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })
})
