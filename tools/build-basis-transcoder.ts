// Builds the KTX2 transcoder that the engine ships in packages/engine/vendor/basis, from Basis
// Universal's source at a pinned release, with a pinned Emscripten SDK. Run it with
// `bun tools/build-basis-transcoder.ts`.
//
// The official build makes its JavaScript bindings with `new Function`, which a page's
// Content-Security-Policy blocks unless it allows 'unsafe-eval'. This build uses the same sources,
// settings and compiler flags as the official one (webgl/transcoder/CMakeLists.txt), with these
// changes: `-sDYNAMIC_EXECUTION=0`, so the bindings need no eval, and `-sEXPORT_ES6=1` with
// `-sENVIRONMENT=web,worker`, so the script is an ES module that a module worker imports, with no
// code for Node. The SDK and the sources download into
// target/basis-transcoder, which git ignores; nothing installs outside it. After the build, the
// script transcodes the repository's KTX2 test files with this build and with the official one, into
// every format the engine asks for, and fails unless both write the same bytes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { transcodeTestFiles } from './lib/basis-transcoder.ts';

const ROOT = join(import.meta.dirname, '..');
const WORK = join(ROOT, 'target/basis-transcoder');
const VENDOR = join(ROOT, 'packages/engine/vendor/basis');

/** The Emscripten SDK release, and the SHA-256 of its source archive. */
const EMSDK = {
	version: '4.0.15',
	url: 'https://github.com/emscripten-core/emsdk/archive/refs/tags/4.0.15.tar.gz',
	sha256: '35be7626493e3bd22860ee2177147f9bca3b6ff871edeab27c5b061a9ed9d23d',
};

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

function run(command: string, args: string[], cwd: string): void {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

/** Downloads and unpacks an archive into `WORK`, once, after checking its SHA-256. */
async function unpack(name: string, { url, sha256 }: { url: string; sha256: string }) {
	const archive = join(WORK, `${name}.tar.gz`);
	if (!existsSync(archive)) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
		writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
	}
	const got = createHash('sha256').update(readFileSync(archive)).digest('hex');
	if (got !== sha256) throw new Error(`${archive}: SHA-256 ${got}, expected ${sha256}`);
	run('tar', ['-xzf', archive, '-C', WORK], WORK);
}

/** Runs a command of the SDK with its environment. */
function emscripten(command: string, cwd: string): void {
	const sdk = join(WORK, `emsdk-${EMSDK.version}`);
	run('bash', ['-c', `EMSDK_QUIET=1 source "${sdk}/emsdk_env.sh" && ${command}`], cwd);
}

async function main(): Promise<void> {
	mkdirSync(WORK, { recursive: true });
	await unpack('emsdk', EMSDK);
	await unpack('basis', BASIS);
	const sdk = join(WORK, `emsdk-${EMSDK.version}`);
	run('./emsdk', ['install', EMSDK.version], sdk);
	run('./emsdk', ['activate', EMSDK.version], sdk);

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
		emscripten(`emcc -c ${flags} "${join(source, file)}" -o "${object}"`, out);
		objects.push(`"${object}"`);
	}
	emscripten(
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
