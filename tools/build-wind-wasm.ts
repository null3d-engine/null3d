// Builds the wind add-on's WebAssembly module, which its task runs in the engine's job workers, and
// writes it into the add-on's package folder. The engine's build runs this with its other builds,
// and the add-on's pack runs it before it packs.
//
// The module is the analytic field alone: the air at many places, from the settings, the ring of
// pushes and the gust, and a time. It imports nothing, holds its buffers once, and never grows its
// memory after it starts.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = 'null3d-wind-wasm';
const TARGET = 'wasm32-unknown-unknown';
const BUILT = join(root, 'target', TARGET, 'release', 'null3d_wind_wasm.wasm');
const OUT = join(root, 'packages', 'wind', 'dist', 'wind.wasm');

execFileSync('cargo', ['build', '--package', CRATE, '--release', '--target', TARGET], {
	cwd: root,
	stdio: 'inherit',
});

// The same optimizer that the engine's own WebAssembly takes, which carries the module well under
// the budget of a file that an add-on loads after the start.
execFileSync(join(root, 'node_modules/.bin/wasm-opt'), ['-Oz', BUILT, '-o', BUILT], {
	stdio: 'inherit',
});

// The file goes in place whole, so a dev server or a page of the same checkout never reads half of
// it while a build writes it.
mkdirSync(dirname(OUT), { recursive: true });
const temporary = `${OUT}.${process.pid}.tmp`;
copyFileSync(BUILT, temporary);
renameSync(temporary, OUT);
const bytes = statSync(OUT).size;
console.log(`wrote packages/wind/dist/wind.wasm, ${(bytes / 1024).toFixed(1)} KB`);
