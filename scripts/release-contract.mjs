import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { validRange } from 'semver'

const root = resolve(new URL('..', import.meta.url).pathname)
const expectedDist = ['index.d.ts', 'index.d.ts.map', 'index.js', 'index.js.map']
const packageDirs = [
  'packages/agent',
  'packages/agent-service',
  'packages/agent-server',
  'packages/agent-a2a',
  'packages/agent-acp',
]

function fail(message) {
  throw new Error(`release contract: ${message}`)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path.slice(directory.length + 1)]
  })
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
  }
  return value
}

function assertPublicRange(group, name, value) {
  const range = String(value)
  assert(range.length > 0, `${group}.${name} is empty`)
  assert(!/^(?:workspace:|file:|link:|git:|git\+|git@|https?:|npm:)/i.test(range), `${group}.${name} is not a public semver range`)
  assert(validRange(range, { loose: false }) !== null, `${group}.${name} is not a valid semver range`)
}

function assertNoClassicAuth() {
  for (const key of Object.keys(process.env)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    const credential = ['auth', 'token', 'username', 'password', 'email', 'certfile', 'keyfile'].some((term) => normalized.includes(term))
    if ((normalized.includes('npm') || normalized.includes('node')) && credential) fail(`classic npm credential environment variable is set: ${key}`)
  }
  const configs = new Set([join(root, '.npmrc')])
  try {
    configs.add(execFileSync('npm', ['config', 'get', 'userconfig'], { encoding: 'utf8' }).trim())
    configs.add(execFileSync('npm', ['config', 'get', 'globalconfig'], { encoding: 'utf8' }).trim())
  } catch {
    fail('could not resolve npm user/global config paths')
  }
  for (const path of configs) {
    if (!path || !existsSync(path)) continue
    const content = readFileSync(path, 'utf8')
    const credential = '(?:_authToken|_auth|authToken|username|_password|password|email|certfile|keyfile)'
    const scopedPrefix = '(?:(?:\\/\\/[^\\n=]+|@[^\\n=]+):)?'
    assert(!new RegExp(`(^|\\n)\\s*${scopedPrefix}${credential}\\s*=`, 'im').test(content), `classic npm credential config entry found in ${path}`)
    assert(!/(^|\n)\s*(?:npm[-_.])?token\s*=/im.test(content), `classic npm token config entry found in ${path}`)
  }
}

function assertNpmVersion() {
  const version = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim().split('.').map(Number)
  assert(version.length === 3 && (version[0] > 11 || (version[0] === 11 && (version[1] > 5 || (version[1] === 5 && version[2] >= 1)))), 'npm 11.5.1 or newer is required')
}

function packageManifest(packageDir) {
  const path = join(root, packageDir, 'package.json')
  assert(existsSync(path), `missing manifest: ${packageDir}`)
  const manifest = readJson(path)
  assert(manifest.name?.startsWith('@aihu/'), `${packageDir} must publish under @aihu`)
  assert(manifest.version && !manifest.version.includes('workspace'), `${manifest.name} has an invalid version`)
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(manifest[group] ?? {})) assertPublicRange(group, name, range)
  }
  assert(JSON.stringify(manifest.files) === JSON.stringify(['dist', 'README.md', 'LICENSE']), `${manifest.name} files allowlist changed`)
  assert(manifest.exports?.['.']?.import === './dist/index.js', `${manifest.name} root import export is invalid`)
  assert(manifest.exports?.['.']?.types === './dist/index.d.ts', `${manifest.name} root type export is invalid`)
  const dist = join(root, packageDir, 'dist')
  assert(existsSync(dist), `${manifest.name} has no dist directory`)
  const actualDist = filesUnder(dist).sort()
  assert(JSON.stringify(actualDist) === JSON.stringify([...expectedDist].sort()), `${manifest.name} dist contains unexpected files`)
  for (const path of expectedDist) assert(existsSync(join(dist, path)), `${manifest.name} dist is missing ${path}`)
  return { manifest, packageDir }
}

function assertTarball(packageInfo, tarball) {
  assert(tarball && existsSync(tarball), `${packageInfo.manifest.name} tarball is missing`)
  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((entry) => entry.replace(/\/$/, '')).sort()
  const expected = ['package/package.json', 'package/README.md', 'package/LICENSE', ...expectedDist.map((path) => `package/dist/${path}`)].sort()
  assert(JSON.stringify(entries) === JSON.stringify(expected), `${packageInfo.manifest.name} tarball does not match the exact file allowlist`)
  const packed = JSON.parse(execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }))
  const keys = ['name', 'version', 'main', 'module', 'types', 'exports', 'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'files', 'publishConfig', 'os', 'cpu', 'libc']
  for (const key of keys) assert(JSON.stringify(stable(packed[key])) === JSON.stringify(stable(packageInfo.manifest[key])), `${packageInfo.manifest.name} packed manifest differs at ${key}`)
}

const requested = process.argv.find((arg) => arg.startsWith('--package='))?.slice('--package='.length)
const tarball = process.argv.find((arg) => arg.startsWith('--tarball='))?.slice('--tarball='.length)
const packages = requested ? [requested] : packageDirs
assertNoClassicAuth()
assertNpmVersion()
for (const packageDir of packages) assert(packageDirs.includes(packageDir), `package is outside the release allowlist: ${packageDir}`)
for (const packageDir of packages) {
  const info = packageManifest(packageDir)
  if (tarball) assertTarball(info, tarball)
  console.log(`release contract passed for ${info.manifest.name}@${info.manifest.version}`)
}
