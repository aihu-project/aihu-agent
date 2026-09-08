export type ProtocolSupport = 'core' | 'supported' | 'deprecated'

export interface ProtocolCompatibility {
  packageName: string
  role: string
  protocol: string
  support: ProtocolSupport
  compatibility: string
}

/**
 * The public protocol boundary is deliberately data-only. Keeping this matrix
 * next to the registry makes the compatibility promise testable without
 * coupling the registry package to any server or transport dependency.
 */
export const protocolCompatibility: readonly ProtocolCompatibility[] = [
  {
    packageName: '@aihu/agent',
    role: 'metadata registry',
    protocol: 'Aihu agent metadata',
    support: 'core',
    compatibility: 'Compiler-emitted metadata consumed by the service and adapters.',
  },
  {
    packageName: '@aihu/agent-service',
    role: 'authorization and live dispatch',
    protocol: 'Aihu agent-service API',
    support: 'supported',
    compatibility: 'Stable service seam for adapters; protocol-neutral.',
  },
  {
    packageName: '@aihu/agent-a2a',
    role: 'protocol adapter',
    protocol: 'A2A v1.0.1 JSON-RPC',
    support: 'supported',
    compatibility: 'Implements the documented A2A v1.0.1 routes and task model.',
  },
  {
    packageName: '@aihu/agent-server',
    role: 'server-side MCP and browser bridge',
    protocol: 'MCP plus Aihu capability bridge',
    support: 'supported',
    compatibility: 'MCP is exposed through the server package; bridge messages use protocol version 1.',
  },
  {
    packageName: '@aihu/agent-acp',
    role: 'legacy adapter',
    protocol: 'historical BeeAI ACP shape',
    support: 'deprecated',
    compatibility: 'Frozen compatibility surface; migrate consumers to @aihu/agent-a2a.',
  },
] as const
