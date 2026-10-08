// Builds the asset tool's FBX and OBJ reader, packages/cli/vendor/ufbx/ufbx.wasm, from ufbx's
// source at a pinned release and the tool's own code in packages/cli/native/fbx.c, with the pinned
// Emscripten SDK of tools/lib/emsdk.ts. Run it with `bun tools/build-ufbx.ts`.
//
// The module is standalone WebAssembly: it imports one function, which tells its host that its
// memory grew, and needs no JavaScript glue. The build leaves out the parts of ufbx that the tool
// never calls: file access, subdivision, NURBS tessellation, geometry caches and skinning on the
// CPU. The sources download into target/ufbx, which git ignores, and the SDK into target/emsdk.
// The build is repeatable: the same sources and SDK give the same bytes, and the CLI's tests pin
// the module's SHA-256.
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emscripten, unpack } from './lib/emsdk.ts';

const ROOT = join(import.meta.dirname, '..');
const WORK = join(ROOT, 'target/ufbx');
const VENDOR = join(ROOT, 'packages/cli/vendor/ufbx');

/** ufbx v0.23.1 (commit 26a482a), and the SHA-256 of its source archive. */
const UFBX = {
	folder: 'ufbx-0.23.1',
	url: 'https://github.com/ufbx/ufbx/archive/refs/tags/v0.23.1.tar.gz',
	sha256: '21edd1021dfb430e37aa6214c9b3bbaa5634b1859cbbef7231e738af4f19c956',
};

/** The parts of ufbx that the build leaves out, and the build's other definitions. */
const DEFINITIONS = [
	'NDEBUG',
	'UFBX_NO_STDIO',
	'UFBX_NO_SUBDIVISION',
	'UFBX_NO_TESSELLATION',
	'UFBX_NO_GEOMETRY_CACHE',
	'UFBX_NO_SKINNING_EVALUATION',
].map((definition) => `-D${definition}`);

const LINK_FLAGS = [
	'-sSTANDALONE_WASM=1',
	'--no-entry',
	'-sALLOW_MEMORY_GROWTH=1',
	'-sMAXIMUM_MEMORY=4GB',
	'-sMALLOC=emmalloc',
	'-sEXPORTED_FUNCTIONS=_n3d_convert,_n3d_release,_n3d_alloc,_n3d_free',
];

async function main(): Promise<void> {
	const emcc = await emscripten();
	await unpack(WORK, 'ufbx', UFBX);
	const source = join(WORK, UFBX.folder);
	const out = join(WORK, 'out');
	mkdirSync(out, { recursive: true });
	const files = [join(source, 'ufbx.c'), join(ROOT, 'packages/cli/native/fbx.c')];
	emcc(
		`emcc -O2 ${DEFINITIONS.join(' ')} -I"${source}" ${files.map((file) => `"${file}"`).join(' ')} ${LINK_FLAGS.join(' ')} -o ufbx.wasm`,
		out,
	);
	mkdirSync(VENDOR, { recursive: true });
	// The compiler marks its output executable, which a vendored file must not be.
	for (const [from, to] of [
		[join(out, 'ufbx.wasm'), 'ufbx.wasm'],
		[join(source, 'LICENSE'), 'LICENSE'],
	] as const) {
		copyFileSync(from, join(VENDOR, to));
		chmodSync(join(VENDOR, to), 0o644);
	}
	const hash = createHash('sha256')
		.update(readFileSync(join(VENDOR, 'ufbx.wasm')))
		.digest('hex');
	console.log(`wrote ${VENDOR}: ufbx.wasm SHA-256 ${hash}`);
}

await main();
