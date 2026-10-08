import assert from 'node:assert/strict';
import test from 'node:test';
import { validateContext, validatePack } from '../scripts/verify-release.mjs';

function context() {
  return {
    manifest: {
      name: 'dsh-response-effort', version: '0.2.1',
      repository: { url: 'git+https://github.com/lolkda/dsh-response-effort.git' },
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/', provenance: false },
    },
    lockfile: { name: 'dsh-response-effort', version: '0.2.1', packages: { '': { version: '0.2.1' } } },
    event: 'push', ref: 'refs/tags/v0.2.1', repository: 'lolkda/dsh-response-effort',
  };
}

function artifact() {
  return {
    name: 'dsh-response-effort', version: '0.2.1', filename: 'dsh-response-effort-0.2.1.tgz',
    files: ['package.json', 'README.md', 'cordis.patch.yml', 'dist/index.js', 'dist/client.js', 'dist/index.js.map', 'dist/client.js.map', 'dist/types/index.d.ts', 'dist/types/host/cache.d.ts'].map((path) => ({ path })),
  };
}

test('matching stable release tags permit publishing', () => {
  assert.deepEqual(validateContext(context()), { publish: true, version: '0.2.1' });
});

test('manual checks never permit publishing, including matching tag refs', () => {
  for (const ref of ['refs/heads/main', 'refs/tags/v0.2.1']) {
    assert.deepEqual(validateContext({ ...context(), event: 'workflow_dispatch', ref }), { publish: false, version: '0.2.1' });
  }
});

test('branch pushes, mismatched tags, unsupported events and foreign repositories are rejected', () => {
  for (const change of [
    { ref: 'refs/heads/main' }, { ref: 'refs/tags/v0.2.2' }, { ref: 'refs/tags/0.2.1' },
    { event: 'pull_request' }, { repository: 'someone/dsh-response-effort' },
    { event: 'workflow_dispatch', ref: 'refs/heads/other' },
  ]) assert.throws(() => validateContext({ ...context(), ...change }));
});

test('prerelease, malformed and non-string package versions are rejected', () => {
  for (const version of ['0.2.1-beta.1', '0.2.1+metadata', '00.2.1', '0.2', '$(echo bad)', undefined, 1]) {
    const input = context();
    input.manifest.version = version;
    assert.throws(() => validateContext(input));
  }
});

test('wrong package identity, repository, registry, access or provenance are rejected', () => {
  for (const change of [
    { name: 'other' }, { repository: { url: 'git+https://github.com/other/repo.git' } },
    { publishConfig: { ...context().manifest.publishConfig, registry: 'https://example.test/' } },
    { publishConfig: { ...context().manifest.publishConfig, access: 'restricted' } },
    { publishConfig: { ...context().manifest.publishConfig, provenance: true } },
  ]) {
    const input = context();
    Object.assign(input.manifest, change);
    assert.throws(() => validateContext(input));
  }
});

test('root and top-level lockfile versions must match the release', () => {
  const input = context();
  input.lockfile.version = '0.2.0';
  assert.throws(() => validateContext(input));
  input.lockfile.version = '0.2.1';
  input.lockfile.packages[''].version = '0.2.0';
  assert.throws(() => validateContext(input));
});

test('packed build, declarations and documentation pass the file allowlist', () => {
  assert.equal(validatePack({ manifest: context().manifest, packs: [artifact()] }), 'dsh-response-effort-0.2.1.tgz');
});

test('credentials, sources, notes, demos and unexpected files never enter the package', () => {
  for (const path of ['.npmrc', '.git/npm-publish-auth.npmrc', '.agents/notes/note.md', 'src/index.ts', 'pelican-coastal-ride.html', 'dist/secret.json', 'dist/types/../../.npmrc']) {
    const pack = artifact();
    pack.files.push({ path });
    assert.throws(() => validatePack({ manifest: context().manifest, packs: [pack] }));
  }
});

test('missing build output, multiple artifacts and mismatched package versions are rejected', () => {
  const manifest = context().manifest;
  const incomplete = artifact();
  incomplete.files = incomplete.files.filter((file) => file.path !== 'dist/index.js');
  assert.throws(() => validatePack({ manifest, packs: [incomplete] }));
  assert.throws(() => validatePack({ manifest, packs: [artifact(), artifact()] }));
  assert.throws(() => validatePack({ manifest, packs: [{ ...artifact(), version: '0.2.2' }] }));
});
