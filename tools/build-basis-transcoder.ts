// Builds the KTX2 transcoder that the engine ships in packages/engine/vendor/basis, from Basis
// Universal's source at a pinned release, with the pinned Emscripten SDK of tools/lib/emsdk.ts.
// Run it with
// `bun tools/build-basis-transcoder.ts`.
//
// The official build makes its JavaScript bindings with `new Function`, which a page's
// Content-Security-Policy blocks unless it allows 'unsafe-eval'. This build uses the same sources,
// settings and compiler flags as the official one (webgl/transcoder/CMakeLists.txt), with these
// changes: `-sDYNAMIC_EXECUTION=0`, so the bindings need no eval, and `-sEXPORT_ES6=1` with
// `-sENVIRONMENT=web,worker`, so the script is an ES module that a module worker imports, with no
// code for Node. The sources download into target/basis-transcoder, which git ignores, and the SDK
// into target/emsdk; nothing installs outside them. After the build, the
// script transcodes the repository's KTX2 test files with this build and with the official one, into
// every format the engine asks for, and fails unless both write the same bytes.
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transcodeTestFiles } from './lib/basis-transcoder.ts';
import { emscripten, unpack } from './lib/emsdk.ts';

const ROOT = join(import.meta.dirname, '..');
const WORK = join(ROOT, 'target/basis-transcoder');
const VENDOR = join(ROOT, 'packages/engine/vendor/basis');

/** Basis Universal v2.50 (tag v2_50, commit 9bebe16), and the SHA-256 of its source archive. */
const BASIS = {
	folder: 'basis_universal-2_50',
	url: 'https://github.com/BinomialLLC/basis_universal/archive/refs/tags/v2_50.tar.gz',
	sha256: '216e49e1f4213d4bfa4afaa07527e16bac28533dddd444197d3aa19230ac130c',
};

/** The official build's definitions, from webgl/transcoder/CMakeLists.txt. */
const DEFINITIONS = [
	'NDEBUG',
	'BASISD_SUPPORT_UASTC_HDR=1',
	'BASISD_SUPPORT_UASTC=1',
	'BASISD_SUPPORT_BC7=1',
	'BASISD_SUPPORT_ATC=0',
	'BASISD_SUPPORT_ASTC_HIGHER_OPAQUE_QUALITY=0',
	'BASISD_SUPPORT_PVRTC2=0',
	'BASISD_SUPPORT_FXT1=0',
	'BASISD_SUPPORT_ETC2_EAC_RG11=0',
	'BASISU_SUPPORT_ENCODING=0',
	'BASISD_ENABLE_DEBUG_FLAGS=1',
	'BASISD_SUPPORT_KTX2=1',
	'BASISD_SUPPORT_KTX2_ZSTD=1',
].map((definition) => `-D${definition}`);

/** The official build's link flags, then this build's changes. */
const LINK_FLAGS = [
	'--bind',
	'-sALLOW_MEMORY_GROWTH=1',
	'-O3',
	'-sMALLOC=emmalloc',
	'-sMODULARIZE=1',
	'-sEXPORT_NAME=BASIS',
	'-sASSERTIONS=0',
	"-sEXPORTED_RUNTIME_METHODS=['HEAP8']",
	'-sDYNAMIC_EXECUTION=0',
	'-sEXPORT_ES6=1',
	'-sENVIRONMENT=web,worker',
];

async function main(): Promise<void> {
	const emcc = await emscripten();
	await unpack(WORK, 'basis', BASIS);

	const source = join(WORK, BASIS.folder);
	const out = join(WORK, 'out');
	mkdirSync(out, { recursive: true });
	const compile = ['-O3', '-fno-strict-aliasing', ...DEFINITIONS, `-I${source}/transcoder`];
	const objects: string[] = [];
	for (const [file, std] of [
		['transcoder/basisu_transcoder.cpp', '-std=c++17'],
		['webgl/transcoder/basis_wrappers.cpp', '-std=c++17'],
		['zstd/zstddeclib.c', ''],
	] as const) {
		const object = join(out, `${file.split('/').at(-1)}.o`);
		const flags = [...compile, std].filter(Boolean).join(' ');
		emcc(`emcc -c ${flags} "${join(source, file)}" -o "${object}"`, out);
		objects.push(`"${object}"`);
	}
	emcc(
		`emcc ${objects.join(' ')} ${LINK_FLAGS.map((flag) => `"${flag}"`).join(' ')} -o basis_transcoder.mjs`,
		out,
	);
	const glue = readFileSync(join(out, 'basis_transcoder.mjs'), 'utf8');
	if (/new Function|\beval\(/.test(glue))
		throw new Error('the built script still makes code from strings');

	const official = join(source, 'webgl/transcoder/build');
	const [built, reference] = await Promise.all([
		transcodeTestFiles(join(out, 'basis_transcoder.mjs'), join(out, 'basis_transcoder.wasm')),
		transcodeTestFiles(
			join(official, 'basis_transcoder.js'),
			join(official, 'basis_transcoder.wasm'),
		),
	]);
	for (const [key, hash] of reference) {
		if (built.get(key) !== hash) throw new Error(`${key}: the two builds write different bytes`);
		console.log(`${key}: the same bytes, SHA-256 ${hash}`);
	}
	// The compiler marks its output executable, which a vendored file must not be.
	for (const file of ['basis_transcoder.mjs', 'basis_transcoder.wasm']) {
		copyFileSync(join(out, file), join(VENDOR, file));
		chmodSync(join(VENDOR, file), 0o644);
	}
	console.log(`wrote ${VENDOR}`);
}

await main();
