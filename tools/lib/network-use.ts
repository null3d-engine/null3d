// Guards what the docs promise about the network: the engine, its loader and its add-ons contact no
// server of their own. Shipped code may call `fetch`, or use another network API, only where the
// record below names the file, with the count and the reason. A new call fails the check until this
// record and docs/getting-started/network-use.md say what it downloads.
//
// Vendored glue holds a download path of its own. The engine reaches none of it, because it hands
// each decoder its compiled module, which `unreachedVendorProblems` checks. The build's generated
// shader modules are not read: the shader library that the build writes them from is.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** What a shipped file may do that reaches the network, and why it contacts no server. */
export interface NetworkUse {
	/** What the file downloads, and why that is not a server that null3D chooses. */
	readonly why: string;
	/** How many `fetch(` forms the file holds, so a second call in the same file fails too. */
	readonly fetch?: number;
	/**
	 * How many times each forbidden API appears. Only vendored glue records one: its own download
	 * path never runs, because the shipped file that imports it supplies the compiled module.
	 */
	readonly apis?: Readonly<Record<string, number>>;
}

/**
 * The only files that may reach the network, each with its counts and the reason.
 *
 * Every null3D file downloads a file that the page names: the engine's own files, the sketch module,
 * or an address from the sketch. The vendored glue holds a fallback that downloads its WebAssembly.
 */
export const NETWORK_USES: Readonly<Record<string, NetworkUse>> = {
	'packages/engine/src/page/early-core.ts': {
		fetch: 1,
		why: "starts the engine core's own file, beside the engine's code",
	},
	'packages/engine/src/page/engine.ts': {
		fetch: 2,
		why: 'prefetches the sketch module that the page passes in, and downloads the recording that a replay page names',
	},
	'packages/engine/src/scene/area-light-tables.ts': {
		fetch: 1,
		why: "downloads the engine's own area light tables",
	},
	'packages/engine/src/scene/assets.ts': {
		fetch: 2,
		why: 'downloads the addresses that the sketch asks for, and a file again from the cache',
	},
	'packages/engine/src/shared/wasm.ts': {
		fetch: 1,
		why: "downloads the engine's own WebAssembly and that of an add-on's task",
	},
	'packages/engine/src/shared/worker-start.ts': {
		fetch: 1,
		why: "reads a worker script's status while the engine names a startup failure",
	},
	'packages/splats/src/system.ts': {
		fetch: 1,
		why: "downloads the SPZ file that the sketch names, and a streamed cloud's index beside it",
	},
	'packages/splats/src/stream.ts': {
		fetch: 1,
		why: 'downloads only the chunk files that the view asks for, which is what makes a large cloud appear without the whole file',
	},
	'packages/vite-plugin/src/engine-shaders.ts': {
		fetch: 2,
		why: "the build fetches the engine's shader release, and declares the fetch it offers",
	},
	'packages/cli/src/devtools.js': {
		fetch: 1,
		apis: { WebSocket: 2 },
		why: "reads the debugging address of the browser that the tool started, on this machine's own loopback, over its debugging socket",
	},
	'packages/engine/vendor/draco/draco_wasm_wrapper_gltf.js': {
		fetch: 2,
		apis: { XMLHttpRequest: 3, importScripts: 1 },
		why: "the vendored Draco glue's own fallback download, never taken because `scene/gltf-draco.ts` hands it its compiled module",
	},
	'packages/engine/vendor/basis/basis_transcoder.mjs': {
		fetch: 2,
		apis: { XMLHttpRequest: 1 },
		why: "the vendored Basis transcoder's own fallback download, never taken because `scene/ktx2-transcode.ts` hands it its compiled module",
	},
	'packages/cli/vendor/basis/basis_encoder.js': {
		fetch: 2,
		apis: { XMLHttpRequest: 6 },
		why: "the vendored Basis encoder's own fallback download, never taken because `src/assets/encoder.js` hands it its compiled module",
	},
};

/** Calls that reach the network, or report about it, which no shipped file may make on its own. */
export const FORBIDDEN_APIS: readonly (readonly [string, RegExp])[] = [
	['XMLHttpRequest', /\bXMLHttpRequest\b/],
	['WebSocket', /\bWebSocket\b/],
	['EventSource', /\bEventSource\b/],
	['WebTransport', /\bWebTransport\b/],
	['RTCPeerConnection', /\bRTCPeerConnection\b/],
	['sendBeacon', /\bsendBeacon\b/],
	['importScripts', /\bimportScripts\b/],
	['navigator.connection', /\bnavigator\.connection\b/],
];

/** An absolute host that shipped code may name, with the reason that it makes no request. */
export interface AllowedHost {
	/** The host, or its suffix, as written after the scheme. */
	readonly host: string;
	readonly why: string;
}

/** The hosts that shipped code may name. */
export const ALLOWED_HOSTS: readonly AllowedHost[] = [
	{ host: 'example.com', why: 'example addresses in error messages, never fetched' },
	{ host: 'www.w3.org', why: 'the SVG namespace name, which makes no request' },
	{ host: 'null3d.invalid', why: 'a reserved name that builds a cache key and never resolves' },
	{ host: 'github.com', why: 'a link in a message or the help text' },
	{ host: 'www.google.com', why: 'a link to install Chrome, printed when it is missing' },
	{ host: 'localhost', why: 'a base for parsing a path, or a server on this machine' },
	{ host: '127.0.0.1', why: 'a server on this machine' },
	{ host: 'page', why: "a stand-in base, so that a built page's own path parses" },
	{ host: 'x', why: "a stand-in base, so that a request's own path parses" },
];

/**
 * A call to the global `fetch`: bare, reached through the global object by name, or reached through
 * a bracket key. A method that happens to be named `fetch` does not count. A key built at run time
 * from pieces cannot be seen here.
 */
const FETCH_CALL =
	/(?:(?:globalThis|window|self)\s*(?:\?\.|\.)\s*fetch|(?:globalThis|window|self)\s*(?:\?\.)?\s*\[\s*(['"`])fetch\1\s*\]|(?<![.\w])fetch)\s*(?:\?\.)?\s*\(/g;
/** An absolute address in a string, as a template or a plain literal gives it. */
const ABSOLUTE_URL = /(https?|wss?):\/\/([^\s"'`)]+)/g;
/** A protocol-relative address in a string, which reaches the same host with no scheme. */
const PROTOCOL_RELATIVE = /(['"`])\s*\/\/([^\s"'`/)]+)/g;
/** The source files that a package ships: no tests, declarations or installed packages. */
const SOURCE = /\.(?:[cm]?[jt]s)$/;
const NOT_SHIPPED = /\.test\.[cm]?[jt]s$|\.d\.[cm]?ts$/;

/** The folders that a build writes, whose code comes from the package's source. */
const BUILT = new Set(['dist', 'generated', 'lib', 'node_modules', 'target']);

/** The reason that `host` may be named, or nothing when it may not. */
export function allowedHost(host: string): string | undefined {
	const bare = host.replace(/[.;,]+$/, '').split(':')[0] ?? '';
	return ALLOWED_HOSTS.find((allowed) => bare === allowed.host || bare.endsWith(`.${allowed.host}`))
		?.why;
}

/** A folder whose files the build writes, so they are not hand-written source. */
const GENERATED = new Set(['generated', 'node_modules']);

/** The shipped source files under `dir`, as absolute paths. */
function sourceFiles(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir, { recursive: true, encoding: 'utf8' });
	} catch {
		return [];
	}
	return entries
		.filter((entry) => SOURCE.test(entry) && !NOT_SHIPPED.test(entry))
		.filter((entry) => !entry.split(sep).some((part) => GENERATED.has(part)))
		.map((entry) => join(dir, entry));
}

/**
 * The top-level folders of a package that hold the code it ships: those its manifest names, plus
 * the source that a build turns into its library. A folder that the manifest does not name does not
 * ship, and a built folder comes from the source, so neither is read again.
 */
function shippedFolderNames(packageDir: string): string[] {
	let entries: string[];
	try {
		const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
			files?: string[];
		};
		entries = (manifest.files ?? []).filter((entry) => !entry.startsWith('!'));
	} catch {
		entries = ['src', 'bin', 'vendor', 'templates'];
	}
	const names = new Set(['src', ...entries.map((entry) => entry.split('/')[0] ?? '')]);
	names.delete('');
	return [...names].filter((name) => !BUILT.has(name));
}

/** The folders whose shipped files the check reads, relative to the repository root. */
export function checkedFolders(root: string): string[] {
	const packageRoot = join(root, 'packages');
	const names = existsSync(packageRoot) ? readdirSync(packageRoot) : [];
	const folders = names.flatMap((name) => {
		const dir = join(packageRoot, name);
		return shippedFolderNames(dir)
			.map((folder) => join(dir, folder))
			.filter((folder) => existsSync(folder) && statSync(folder).isDirectory());
	});
	folders.push(join(root, 'examples/addons'));
	return folders;
}

/**
 * Every way that the shipped files under `root` break the network promise, as `path: problem`, and
 * the count of files read and calls found.
 */
export function networkProblems(root: string): {
	problems: string[];
	files: number;
	calls: number;
} {
	const problems: string[] = [];
	let files = 0;
	let calls = 0;
	const seen = new Set<string>();
	const apiPatterns = FORBIDDEN_APIS.map(
		([name, pattern]) => [name, new RegExp(pattern.source, 'g')] as const,
	);
	for (const file of checkedFolders(root).flatMap(sourceFiles)) {
		if (seen.has(file)) continue;
		seen.add(file);
		files++;
		const path = relative(root, file).split(sep).join('/');
		const text = readFileSync(file, 'utf8');
		const use = NETWORK_USES[path];
		const foundFetch = text.match(new RegExp(FETCH_CALL, 'g'))?.length ?? 0;
		calls += foundFetch;
		const expectedFetch = use?.fetch ?? 0;
		if (foundFetch !== 0 && !use)
			problems.push(
				`${path}: calls fetch, and no entry in network-use.ts says what it downloads. Add one with the reason, and say so in docs/getting-started/network-use.md`,
			);
		else if (foundFetch !== expectedFetch)
			problems.push(
				`${path}: has ${foundFetch} fetch calls, and network-use.ts records ${expectedFetch}. Update the record and the network use page`,
			);
		for (const [name, pattern] of apiPatterns) {
			const found = text.match(pattern)?.length ?? 0;
			const expected = use?.apis?.[name] ?? 0;
			if (found === expected) continue;
			if (!use || expected === 0) problems.push(`${path}: uses ${name}, which reaches the network`);
			else if (found === 0)
				problems.push(
					`${path}: network-use.ts records ${expected} uses of ${name}, and the file has none. Update the record`,
				);
			else
				problems.push(
					`${path}: has ${found} uses of ${name}, and network-use.ts records ${expected}. Update the record`,
				);
		}
		for (const match of text.matchAll(ABSOLUTE_URL)) {
			const scheme = match[1] ?? '';
			const host = (match[2] ?? '').split('/')[0] ?? '';
			if (!allowedHost(host))
				problems.push(
					`${path}: names ${scheme}://${host}, which is not a recorded example, link or local name`,
				);
		}
		for (const match of text.matchAll(PROTOCOL_RELATIVE)) {
			const host = (match[2] ?? '').split('/')[0] ?? '';
			if (!allowedHost(host))
				problems.push(
					`${path}: names //${host}, which is not a recorded example, link or local name`,
				);
		}
	}
	return { problems, files, calls };
}

/** The records whose file no longer ships, so the record has to go or the file has to return. */
export function staleUseProblems(root: string): string[] {
	const shipped = new Set(
		checkedFolders(root)
			.flatMap(sourceFiles)
			.map((file) => relative(root, file).split(sep).join('/')),
	);
	return Object.keys(NETWORK_USES)
		.filter((path) => !shipped.has(path))
		.map((path) => `${path}: network-use.ts records it, and no such shipped file exists`);
}

/**
 * Every vendored file whose network forms the record names, and which a shipped file imports
 * without handing it the compiled module. Such a file could reach its own download, so the promise
 * that a page contacts no server would fail. Each problem is `path: problem`.
 */
export function unreachedVendorProblems(root: string): string[] {
	const problems: string[] = [];
	const packageRoot = join(root, 'packages');
	const names = existsSync(packageRoot) ? readdirSync(packageRoot) : [];
	const importers = names
		.flatMap((name) => {
			const dir = join(packageRoot, name);
			return shippedFolderNames(dir)
				.filter((folder) => folder !== 'vendor')
				.map((folder) => join(dir, folder));
		})
		.flatMap(sourceFiles);
	const texts = importers.map((file) => ({ file, text: readFileSync(file, 'utf8') }));
	for (const path of Object.keys(NETWORK_USES)) {
		const parts = path.split('/');
		if (parts[2] !== 'vendor' || !existsSync(join(root, path))) continue;
		const tail = parts.slice(2).join('/');
		const users = texts.filter(({ text }) => text.includes(tail));
		if (users.length === 0) {
			problems.push(
				`${path}: holds a download path, and no shipped file imports it. Remove the record, or import the file where the module is handed in`,
			);
			continue;
		}
		for (const { file, text } of users) {
			if (/\b(?:instantiateWasm|wasmBinary)\b/.test(text)) continue;
			const rel = relative(root, file).split(sep).join('/');
			problems.push(
				`${rel}: imports ${tail} without instantiateWasm or wasmBinary, so the vendored download path can run`,
			);
		}
	}
	return problems;
}
