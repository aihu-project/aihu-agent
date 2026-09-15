# @aihu/agent-service

> **Aihu** — agentic discovery and interaction, for human purpose.

Service-side agent runtime (server-hosted agent endpoints).

Part of the **agent surface** layer of Aihu. Every Aihu component exposes its agent surface via the `@agent` block; this package implements the server-side dispatch and authorization seam used by protocol adapters.

<!-- BEGIN_HANDWRITTEN: prose -->
`createAgentService(options)` aggregates registered `@aihu/agent` metadata
(or an explicit `options.manifests` list) into an `AgentService` and exposes
it as MCP-compatible tools via `getManifest()`, `handleToolCall()`,
`authorize()`, and `asMiddleware()`.

```ts
import { createAgentService } from '@aihu/agent-service'

const service = createAgentService({
  // Enables live dispatch; omit for a metadata-only service (404 on every call).
  getRegistry: () => componentInstanceRegistry,
  authPlugin, // optional — required for `$scope`-gated members
  rateLimitPlugin, // optional — required for `$rate-limit`-gated members
})

const result = await service.handleToolCall('quote-card/increment', [])
```

Every call runs a fixed `404 → 401 → 403 → 429` security gate (missing
instance → missing/invalid credential → scope denied → rate limited) before
dispatch; `authorize()` runs the same gate without dispatching, which is how
`@aihu/agent-server`'s capability-bridge keeps the server as policy
authority while the browser instance executes. The lower-level principal
primitives — `resolvePrincipal`, `decideEmission`, `surfaceCallPolicy`, and
`isScopeValue` — back that gate and are exported for adapters that need to
run the same policy decision outside `handleToolCall`.
<!-- END_HANDWRITTEN: prose -->

## Install

<!-- BEGIN_AUTOGEN: install -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

```bash
npm install @aihu/agent-service
# or
bun add @aihu/agent-service
```

<sub><i>Auto-generated against `@aihu/agent-service@0.4.1`.</i></sub>

<!-- END_AUTOGEN: install -->

## Package facts

<!-- BEGIN_AUTOGEN: stats -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| | |
|---|---|
| **Version** | `0.4.1` |
| **Tier** | C — Agent surface — server-side execution + tool dispatch |
| **Bundle size** | 2.76 kB (gz) — limit 2900 B |
| **Published files** | 3 entries |
| **License** | MIT |

<sub><i>Auto-generated against `@aihu/agent-service@0.4.1`.</i></sub>

<!-- END_AUTOGEN: stats -->

## Exports

<!-- BEGIN_AUTOGEN: exports -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

| Subpath | ESM | CJS |
|---|---|---|
| `.` | `./dist/index.js` | `—` |

<sub><i>Auto-generated against `@aihu/agent-service@0.4.1`.</i></sub>

<!-- END_AUTOGEN: exports -->

## Dependencies

<!-- BEGIN_AUTOGEN: deps -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

**Dependencies:**

- `@aihu/agent` — `^0.2.1`

<sub><i>Auto-generated against `@aihu/agent-service@0.4.1`.</i></sub>

<!-- END_AUTOGEN: deps -->

## See also

<!-- BEGIN_AUTOGEN: see-also -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

- [@aihu/agent](../agent)
- [@aihu/agent-a2a](../agent-a2a)
- [@aihu/agent-acp](../agent-acp)
- [Aihu agent repository](https://github.com/aihu-project/aihu-agent)

<sub><i>Auto-generated against `@aihu/agent-service@0.4.1`.</i></sub>

<!-- END_AUTOGEN: see-also -->

## License

<!-- BEGIN_AUTOGEN: license -->
<!-- regenerate: bun scripts/sync-readme.ts (also runs in pre-commit + CI) -->

MIT — see [LICENSE](./LICENSE).

<sub><i>Auto-generated against `@aihu/agent-service@0.4.1`.</i></sub>

<!-- END_AUTOGEN: license -->
