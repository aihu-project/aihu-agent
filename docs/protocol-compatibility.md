# Agent protocol compatibility

The repository separates the metadata registry, authorization service, and
protocol adapters so an application can choose its transport. The matrix is
also exported as data from `@aihu/agent` and tested in
`packages/agent/tests/protocol-matrix.test.ts`.

| Package | Role | Protocol or surface | Status |
| --- | --- | --- | --- |
| `@aihu/agent@0.2.1` | Metadata registry | Aihu agent metadata | Core |
| `@aihu/agent-service@0.4.1` | Authorization and live dispatch | Protocol-neutral service API | Supported |
| `@aihu/agent-a2a@1.0.2` | Protocol adapter | A2A v1.0.1 JSON-RPC | Supported |
| `@aihu/agent-server@0.4.5` | Server-side integration | MCP plus Aihu capability bridge v1 | Supported |
| `@aihu/agent-acp@0.2.2` | Legacy adapter | Historical BeeAI ACP shape | Deprecated |

`@aihu/agent-acp` is frozen compatibility code. It does not claim support for
Zed's unrelated Agent Client Protocol, and new integrations should use
`@aihu/agent-a2a`.

Internal publication order is `@aihu/agent@0.2.1` →
`@aihu/agent-service@0.4.1` → `@aihu/agent-a2a@1.0.2`,
`@aihu/agent-acp@0.2.2`, and `@aihu/agent-server@0.4.5`. The release workflow
enforces this order by requiring every internal prerequisite to exist in npm
before its dependent package can publish. Each package has a public semver
dependency range so the published manifests remain installable outside this
workspace.
