import { describe, expect, it } from 'vitest'
import { protocolCompatibility } from '../src/protocol-matrix.ts'

describe('agent protocol compatibility matrix', () => {
  it('keeps the supported public protocol surfaces explicit', () => {
    expect(protocolCompatibility.map((entry) => entry.packageName)).toEqual([
      '@aihu/agent',
      '@aihu/agent-service',
      '@aihu/agent-a2a',
      '@aihu/agent-server',
      '@aihu/agent-acp',
    ])
    expect(protocolCompatibility.find((entry) => entry.packageName === '@aihu/agent-a2a')).toMatchObject({
      protocol: 'A2A v1.0.1 JSON-RPC',
      support: 'supported',
    })
  })

  it('keeps ACP clearly deprecated with an explicit migration target', () => {
    const acp = protocolCompatibility.find((entry) => entry.packageName === '@aihu/agent-acp')
    expect(acp).toMatchObject({ support: 'deprecated' })
    expect(acp?.compatibility).toContain('@aihu/agent-a2a')
  })
})
