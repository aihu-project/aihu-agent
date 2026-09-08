# Agent protocol compatibility

The repository separates the metadata registry, authorization service, and
protocol adapters so an application can choose its transport. The matrix is
also exported as data from `@aihu/agent` and tested in
`packages/agent/tests/protocol-matrix.test.ts`.

| Package | Role | Protocol or surface | Status |
| --- | --- | --- | --- |
| `@aihu/agent` | Metadata registry | Aihu agent metadata | Core |
| `@aihu/agent-service` | Authorization and live dispatch | Protocol-neutral service API | Supported |
| `@aihu/agent-a2a` | Protocol adapter | A2A v1.0.1 JSON-RPC | Supported |
| `@aihu/agent-server` | Server-side integration | MCP plus Aihu capability bridge v1 | Supported |
| `@aihu/agent-acp` | Legacy adapter | Historical BeeAI ACP shape | Deprecated |

`@aihu/agent-acp` is frozen compatibility code. It does not claim support for
Zed's unrelated Agent Client Protocol, and new integrations should use
`@aihu/agent-a2a`.

Internal publication order is `@aihu/agent` → `@aihu/agent-service` →
`@aihu/agent-a2a` and `@aihu/agent-acp`; `@aihu/agent-server` depends on both
the registry and service and is published after them. Each package has a
public semver dependency range so the published manifests remain installable
outside this workspace.
