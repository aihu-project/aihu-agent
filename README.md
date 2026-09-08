# @aihu/agent

Agent metadata primitives for Aihu components.

`@aihu/agent` provides the small, dependency-free registry used by compiled
components and agent adapters. A compiler-generated module can register a
component's static agent surface, while adapters can look up one component or
take a snapshot of the complete registry.

## Install

```bash
npm install @aihu/agent
# or
bun add @aihu/agent
```

## API

```ts
import {
  getAgentMetadata,
  getAllAgentMetadata,
  registerAgentMetadata,
} from '@aihu/agent'

registerAgentMetadata({
  tag: 'quote-card',
  describes: 'Displays a quote and its source.',
  state: { quote: 'The current quote.' },
})

const card = getAgentMetadata('quote-card')
const allComponents = getAllAgentMetadata()
```

The registry stores metadata by reference and uses last-registration-wins
semantics. This supports module re-evaluation during development without
introducing reactive or runtime dependencies.

## Scope

This package is the core metadata registry only. Protocol adapters and server
dispatch live in separate packages such as `@aihu/agent-service`,
`@aihu/agent-a2a`, `@aihu/agent-acp`, and `@aihu/agent-server`.

## Development

```bash
bun install
bun run lint
bun run typecheck
bun run test
bun run build
bun run pack:check
```

## License

MIT — see [LICENSE](./LICENSE).
