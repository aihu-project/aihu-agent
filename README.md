# Aihu agent packages

The Aihu agent family is published from this repository as small, independently
installable packages:

| Package | Role | Status |
| --- | --- | --- |
| [`@aihu/agent`](./packages/agent) | Dependency-free metadata registry | Supported |
| [`@aihu/agent-service`](./packages/agent-service) | Authorization and live dispatch | Supported |
| [`@aihu/agent-a2a`](./packages/agent-a2a) | A2A v1.0.1 adapter | Supported |
| [`@aihu/agent-server`](./packages/agent-server) | MCP and capability-bridge server integration | Supported |
| [`@aihu/agent-acp`](./packages/agent-acp) | Historical ACP compatibility adapter | Deprecated |

See [the protocol compatibility matrix](./docs/protocol-compatibility.md) for
the supported boundaries and internal publication order. ACP is retained only
for existing compatibility consumers; new integrations should use A2A.

## Development

```bash
npm install --ignore-scripts
npm run typecheck
npm test
npm run build
# release:contract requires npm >= 11.5.1
npm install --global npm@11.5.1
NPM_CONFIG_USERCONFIG=/dev/null npm run release:contract
```

The release contract validates the public semver dependency graph, exact
package contents, lifecycle-disabled installation, and the trusted-publishing
prerequisites. Publishing is driven by the package-specific tags documented in
the release workflow and is intentionally ordered by the dependency graph. The
publish job fails closed unless the tag names the package's exact version, the
tag commit is the current `main` tip, and GitHub associates that commit with a
merged pull request into `main`; this is an automated merge association gate,
not a claim that the workflow performs a separate human approval check.

## License

MIT — see [LICENSE](./LICENSE).
