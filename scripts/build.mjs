import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await build({ absWorkingDir: root, entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24', sourcemap: true });
await build({
  absWorkingDir: root, entryPoints: ['src/client/index.ts'], outfile: 'dist/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', external: ['react', 'react-dom', 'react/jsx-runtime'],
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-response-effort",factory(require){const module={exports:{}};const exports=module.exports;' },
  footer: { js: 'return module.exports;}});' }, sourcemap: true,
});
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
