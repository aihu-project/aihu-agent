/**
 * `@aihu/agent-server` — capability-bridge auth/origin hardening (issue #5).
 *
 * Coverage:
 *  - `isAllowedBridgeOrigin`: the fail-closed origin-allowlist helper
 *    consumers wire into their own WS upgrade handler (this package never
 *    owns the raw socket — see `bridge-origin.ts`).
 *  - `verifyBridgeSession`: a `hello` with no/invalid session token is
 *    rejected exactly like a protocol mismatch — 503 `BRIDGE_UNVERIFIED`,
 *    nothing forwarded; a valid token verifies and the bridge works
 *    end-to-end.
 *  - `sig`: once a session verifies, `invoke` frames are signed with that
 *    token, and a REAL `createBridgeClient` (not a fake) refuses to execute
 *    an invocation whose signature doesn't verify — even over an otherwise
 *    already-connected channel — so a rogue writer into the channel still
 *    cannot drive the dispatcher.
 */

import { registerAgentMetadata } from '@aihu/agent'
import { type AgentBindingSpec, branch, leaf } from '@aihu/arbor'
import { type Signal, signal } from '@aihu/signals'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentServer } from '../src/agent-server.ts'
import { type AgentDispatcher, createBridgeClient } from '../src/bridge-client.ts'
import { isAllowedBridgeOrigin } from '../src/bridge-origin.ts'
import { opaqueActionId } from '../src/opaque-id.ts'
import type { AgentServer, BridgeChannel } from '../src/types.ts'
import { BRIDGE_PROTOCOL_VERSION } from '../src/types.ts'

// ─── isAllowedBridgeOrigin: fail-closed allowlist ────────────────────────────

describe('isAllowedBridgeOrigin', () => {
  const ALLOWED = ['https://app.example.com', 'https://admin.example.com']

  it('allows an exact match', () => {
    expect(isAllowedBridgeOrigin('https://app.example.com', ALLOWED)).toBe(true)
  })

  it('rejects an origin not on the list', () => {
    expect(isAllowedBridgeOrigin('https://evil.example.com', ALLOWED)).toBe(false)
  })

  it('rejects a missing origin, even with a non-empty allowlist', () => {
    expect(isAllowedBridgeOrigin(undefined, ALLOWED)).toBe(false)
    expect(isAllowedBridgeOrigin(null, ALLOWED)).toBe(false)
    expect(isAllowedBridgeOrigin('', ALLOWED)).toBe(false)
  })

  it('rejects everything when the allowlist is empty — no wildcard-allow', () => {
    expect(isAllowedBridgeOrigin('https://app.example.com', [])).toBe(false)
  })

  it('is case-sensitive and does not substring-match', () => {
    expect(isAllowedBridgeOrigin('https://APP.example.com', ALLOWED)).toBe(false)
    expect(isAllowedBridgeOrigin('https://app.example.com.evil.com', ALLOWED)).toBe(false)
  })
})

// ─── Shared fixtures: a real reactive counter, mirroring agent-server.test.ts ─

const TAG = 'bridge-auth-counter'

function makeCounter(): {
  node: ReturnType<typeof branch>
  agentBinding: AgentBindingSpec
  readCount: () => number
} {
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
  return { node, agentBinding, readCount: () => count() }
}

function host(): Element {
  return new JSDOM('<!DOCTYPE html><body></body>').window.document.body
}

beforeEach(() => {
  registerAgentMetadata({
    tag: TAG,
    describes: 'A counter used to test bridge session auth.',
    actions: { increment: { returns: {} } },
    state: { count: 'The current counter value.' },
  })
})

let servers: AgentServer[] = []
let clients: Array<{ dispose(): void }> = []
afterEach(() => {
  for (const c of clients) c.dispose()
  for (const s of servers) s.dispose()
  servers = []
  clients = []
})

function spawn(...args: Parameters<typeof createAgentServer>): AgentServer {
  const s = createAgentServer(...args)
  servers.push(s)
  return s
}

/** A fake bridge whose outbound frames are captured, mirroring agent-server.test.ts. */
function makeFakeBridge(onSend: (data: string) => void): BridgeChannel & {
  reply(data: string): void
} {
  let msgHandler: ((d: string) => void) | null = null
  let closeHandler: (() => void) | null = null
  const open = true
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
  }
}

// ─── verifyBridgeSession: the handshake gate ─────────────────────────────────

describe('verifyBridgeSession — a hello must prove its session, not just its protocol', () => {
  it('a hello with NO sessionToken is rejected when verifyBridgeSession is configured', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => token === 'good-token',
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((d) => sent.push(d))
    server.attachBridge(bridge)
    bridge.reply(JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL_VERSION }))

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(res.code).toBe(503)
    expect(res.error).toContain('BRIDGE_UNVERIFIED')
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })

  it('a hello with an INVALID sessionToken is rejected', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => token === 'good-token',
    })
    const sent: string[] = []
    const bridge = makeFakeBridge((d) => sent.push(d))
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        sessionToken: 'forged-token',
      }),
    )

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(res.code).toBe(503)
    expect(res.error).toContain('BRIDGE_UNVERIFIED')
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })

  it('an async verifyBridgeSession that throws rejects the handshake rather than hanging', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
      verifyBridgeSession: async () => {
        throw new Error('session store unreachable')
      },
    })
    const bridge = makeFakeBridge(() => {})
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL_VERSION, sessionToken: 'x' }),
    )

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      error?: string
    }
    expect(res.code).toBe(503)
    expect(res.error).toContain('BRIDGE_UNVERIFIED')
  })

  it('a hello with a VALID sessionToken verifies and the invoke is forwarded, signed', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => token === 'good-token',
    })
    let lastFrame: { type: string; sig?: string } | null = null
    const bridge = makeFakeBridge((d) => {
      lastFrame = JSON.parse(d)
      const frame = lastFrame as unknown as { callId: string }
      bridge.reply(JSON.stringify({ type: 'result', callId: frame.callId, result: 1 }))
    })
    server.attachBridge(bridge)
    bridge.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        sessionToken: 'good-token',
      }),
    )

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
      result?: unknown
    }
    expect(res.code).toBeUndefined()
    expect(lastFrame).not.toBeNull()
    expect(lastFrame!.type).toBe('invoke')
    // A verified session signs every forwarded invoke.
    expect(typeof lastFrame!.sig).toBe('string')
    expect(lastFrame!.sig!.length).toBeGreaterThan(0)
  })

  it('when verifyBridgeSession is not configured, invoke frames stay unsigned (backward compatible)', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
    })
    let lastFrame: { sig?: string } | null = null
    const bridge = makeFakeBridge((d) => {
      lastFrame = JSON.parse(d)
      const frame = lastFrame as unknown as { callId: string }
      bridge.reply(JSON.stringify({ type: 'result', callId: frame.callId, result: 1 }))
    })
    server.attachBridge(bridge)
    bridge.reply(JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL_VERSION }))

    await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })
    expect(lastFrame).not.toBeNull()
    expect('sig' in (lastFrame as object)).toBe(false)
  })

  it('a new channel must prove its OWN session — a verified token is never inherited', async () => {
    const counter = makeCounter()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      bridgeHandshakeTimeoutMs: 50,
      verifyBridgeSession: (token) => token === 'good-token',
    })
    const good = makeFakeBridge(() => {})
    server.attachBridge(good)
    good.reply(
      JSON.stringify({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL_VERSION,
        sessionToken: 'good-token',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    const sent: string[] = []
    const impostor = makeFakeBridge((d) => sent.push(d))
    server.attachBridge(impostor) // no hello at all this time

    const res = (await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })) as {
      code?: number
    }
    expect(res.code).toBe(503)
    expect(sent.filter((s) => s.includes('"invoke"'))).toHaveLength(0)
  })
})

// ─── End-to-end: a REAL bridge client refuses an unsigned/forged invoke ──────

/** A pair of linked in-memory channels, mirroring bridge-client.test.ts. */
function makeLinkedChannels(): [BridgeChannel, BridgeChannel] {
  const msg: Array<Array<(d: string) => void>> = [[], []]
  const open = true
  const make = (self: 0 | 1): BridgeChannel => {
    const other = self === 0 ? 1 : 0
    return {
      get connected() {
        return open
      },
      send(data) {
        for (const h of [...msg[other]!]) h(data)
      },
      onMessage(h) {
        msg[self]!.push(h)
        return () => {
          msg[self] = msg[self]!.filter((x) => x !== h)
        }
      },
      onClose() {
        return () => {}
      },
    }
  }
  return [make(0), make(1)]
}

function makeBrowserCounter(): { dispatcher: AgentDispatcher; read: () => number } {
  const [count, setCount] = signal(0)
  return {
    read: () => count(),
    dispatcher: {
      tag: TAG,
      actions: {
        [opaqueActionId(TAG, 'increment')]: (args: unknown[]) => {
          const by = typeof args[0] === 'number' ? args[0] : 1
          setCount(count() + by)
          return count()
        },
      },
      reads: {},
      writes: {},
    },
  }
}

describe('full loop: a real bridge client refuses an unverified invoke signature', () => {
  it('a matching sessionToken end-to-end: hello verifies, invoke is signed and executed', async () => {
    const counter = makeCounter()
    const [serverSide, clientSide] = makeLinkedChannels()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => token === 'shared-secret',
    })
    server.attachBridge(serverSide)

    const browser = makeBrowserCounter()
    clients.push(
      createBridgeClient({
        dispatcher: browser.dispatcher,
        channel: clientSide,
        sessionToken: 'shared-secret',
      }),
    )
    // Let the hello cross the wire and verify before driving.
    await Promise.resolve()
    await Promise.resolve()

    const res = (await server.callTool(`${TAG}/increment`, [5], { userId: 'u1' })) as {
      result: unknown
      code?: number
    }
    expect(res.code).toBeUndefined()
    expect(res.result).toBe(5)
    expect(browser.read()).toBe(5)
  })

  it('a rogue frame written into an already-verified channel is refused, not executed', async () => {
    const counter = makeCounter()
    const [serverSide, clientSide] = makeLinkedChannels()
    const server = spawn({
      target: { node: counter.node, agentBinding: counter.agentBinding },
      createHost: host,
      verifyBridgeSession: (token) => token === 'shared-secret',
    })
    server.attachBridge(serverSide)

    const browser = makeBrowserCounter()
    const frames: Array<Record<string, unknown>> = []
    serverSide.onMessage((d) => frames.push(JSON.parse(d)))
    clients.push(
      createBridgeClient({
        dispatcher: browser.dispatcher,
        channel: clientSide,
        sessionToken: 'shared-secret',
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    // A legitimate approved call first, to prove the channel really works.
    await server.callTool(`${TAG}/increment`, [1], { userId: 'u1' })
    expect(browser.read()).toBe(1)

    // Now something else writes DIRECTLY into the channel — bypassing
    // `forwardToBridge` entirely, as if it had somehow gained write access to
    // an already-established, already-verified socket — with an invoke frame
    // that carries no valid signature.
    serverSide.send(
      JSON.stringify({
        type: 'invoke',
        callId: 'rogue-1',
        opaqueActionId: opaqueActionId(TAG, 'increment'),
        args: [999],
        // no `sig`, or a wrong one — either way it must not verify.
        sig: 'not-a-real-signature',
      }),
    )
    // Signature verification goes through `crypto.subtle` (real async work,
    // not just microtask ticks), so wait it out with a macrotask flush rather
    // than a fixed number of `Promise.resolve()` ticks.
    await new Promise((r) => setTimeout(r, 10))

    // The dispatcher must NOT have run the forged invocation.
    expect(browser.read()).toBe(1)
    const errorFrame = frames.find(
      (f) => f.type === 'error' && (f as { callId?: string }).callId === 'rogue-1',
    )
    expect(errorFrame).toBeDefined()
    expect(String(errorFrame?.message)).toContain('BRIDGE_SIG_INVALID')
  })
})
