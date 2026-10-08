import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageName = 'dsh-response-effort';
const repositoryName = 'lolkda/dsh-response-effort';
const registry = 'https://registry.npmjs.org/';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateContext({ manifest, lockfile, event, ref, repository }) {
  assert.equal(repository, repositoryName, 'Unexpected GitHub repository');
  assert.equal(manifest.name, packageName, 'Unexpected package name');
  assert.equal(typeof manifest.version, 'string', 'Missing package version');
  assert.match(manifest.version, stableVersion, 'Only stable versions can use this workflow');
  assert.equal(manifest.repository?.url, `git+https://github.com/${repositoryName}.git`, 'Repository URL must match the trusted publisher');
  assert.equal(manifest.publishConfig?.registry, registry, 'Only the official npm registry is allowed');
  assert.equal(manifest.publishConfig?.access, 'public', 'The npm package must be public');
  assert.equal(manifest.publishConfig?.provenance, false, 'Private source repositories cannot generate provenance');
  assert.equal(lockfile.name, manifest.name, 'Lockfile package name mismatch');
  assert.equal(lockfile.version, manifest.version, 'Lockfile version mismatch');
  assert.equal(lockfile.packages?.['']?.version, manifest.version, 'Lockfile root version mismatch');
  const tagRef = `refs/tags/v${manifest.version}`;
  if (event === 'push') {
    assert.equal(ref, tagRef, 'Release tag must exactly match the package version');
    return { publish: true, version: manifest.version };
  }
  assert.equal(event, 'workflow_dispatch', 'Unsupported workflow event');
  assert.ok(ref === 'refs/heads/main' || ref === tagRef, 'Manual checks must use main or the matching release tag');
  return { publish: false, version: manifest.version };
}

export function validatePack({ manifest, packs }) {
  assert.equal(packs.length, 1, 'Expected exactly one packed artifact');
  const [pack] = packs;
  assert.equal(pack.name, manifest.name, 'Packed package name mismatch');
  assert.equal(pack.version, manifest.version, 'Packed package version mismatch');
  assert.equal(pack.filename, `${manifest.name}-${manifest.version}.tgz`, 'Unexpected artifact filename');
  const paths = new Set(pack.files.map((file) => file.path));
  for (const required of ['package.json', 'README.md', 'cordis.patch.yml', 'dist/index.js', 'dist/client.js', 'dist/types/index.d.ts']) {
    assert.ok(paths.has(required), `Missing packed file: ${required}`);
  }
  for (const path of paths) {
    assert.ok(
      ['package.json', 'README.md', 'cordis.patch.yml'].includes(path)
        || /^dist\/(?:client|index)\.js(?:\.map)?$/.test(path)
        || /^dist\/types\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.d\.ts$/.test(path),
      `Unexpected packed file: ${path}`,
    );
  }
  return pack.filename;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  if (process.argv[2] === 'context') {
    const result = validateContext({
      manifest,
      lockfile: JSON.parse(readFileSync('package-lock.json', 'utf8')),
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      repository: process.env.GITHUB_REPOSITORY,
    });
    console.log(`${manifest.name}@${result.version}: ${result.publish ? 'tag release' : 'validation only; publishing disabled'}`);
  } else if (process.argv[2] === 'pack' && process.argv[3]) {
    const filename = validatePack({ manifest, packs: JSON.parse(readFileSync(process.argv[3], 'utf8')) });
    console.log(`Verified publish artifact: ${filename}`);
  } else {
    throw new Error('Usage: node scripts/verify-release.mjs context | pack <npm-pack.json>');
  }
}
