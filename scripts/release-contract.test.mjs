import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validRange } from 'semver'

test('semver parser rejects malformed public dependency ranges', () => {
  assert.equal(validRange('^0.2.1'), '>=0.2.1 <0.3.0-0')
  assert.equal(validRange('^0.2.1 || evil'), null)
  assert.equal(validRange('workspace:*'), null)
})

test('release pack command is pinned to an unambiguous local package path', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /npm pack --ignore-scripts --pack-destination "\$pack_dir" "\.\/\$PACKAGE"/)
  assert.doesNotMatch(workflow, /npm pack --ignore-scripts --pack-destination "\$pack_dir" "\$PACKAGE"/)
})

test('release governance is explicit and has PR API read access', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /permissions:\n      contents: read\n      id-token: write\n      pull-requests: read/)
  assert.match(workflow, /Require exact merged pull-request association/)
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse origin\/main\)"/)
  assert.match(workflow, /pr\.merged_at &&/)
  assert.match(workflow, /pr\.merge_commit_sha === process\.env\.GITHUB_SHA/)
})
