// Guards what the docs promise about the network: the engine, its loader and its add-ons contact no
// server of their own. Shipped code may call `fetch` only in the files below, and may name an
// absolute address only for the hosts below, which are examples, links or names that never resolve.
// A new call fails the check until this record and docs/getting-started/network-use.md say why.
// The build's own output is not read: the shader modules under `generated` are written from the
// shader library, which the check reads as source.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** A call site that the shipped code may have. */
export interface FetchSite {
	/** How many `fetch(` forms the file holds, so a second call in the same file fails too. */
	readonly count: number;
	/** What the file downloads, and why that is not a server that the engine chooses. */
	readonly why: string;
}

/**
 * The only files that may call `fetch`, each with its count and the reason.
 *
 * Every one downloads a file that the page names: the engine's own files, the sketch module, or an
 * address from the sketch. None names a server of its own.
 */
export const FETCH_SITES: Readonly<Record<string, FetchSite>> = {
	'packages/engine/src/page/early-core.ts': {
		count: 1,
		why: "starts the engine core's own file, beside the engine's code",
	},
	'packages/engine/src/page/engine.ts': {
		count: 1,
		why: 'prefetches the sketch module that the page passes in',
	},
	'packages/engine/src/scene/area-light-tables.ts': {
		count: 1,
		why: "downloads the engine's own area light tables",
	},
	'packages/engine/src/scene/assets.ts': {
		count: 2,
		why: 'downloads the addresses that the sketch asks for, and a file again from the cache',
	},
	'packages/engine/src/shared/wasm.ts': {
		count: 1,
		why: "downloads the engine's own WebAssembly and that of an add-on's task",
	},
	'packages/engine/src/shared/worker-start.ts': {
		count: 1,
		why: "reads a worker script's status while the engine names a startup failure",
	},
	'packages/splats/src/system.ts': {
		count: 1,
		why: 'downloads the SPZ file that the sketch names',
	},
	'packages/vite-plugin/src/engine-shaders.ts': {
		count: 2,
		why: "the build fetches the engine's shader release, and declares the fetch it offers",
	},
};

/** Calls that reach the network, or report about it, which no shipped file may make. */
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
 * A call to the global `fetch`: bare, or reached through the global object. A method that happens
 * to be named `fetch` does not count.
 */
const FETCH_CALL = /(?:(?:globalThis|window|self)\s*(?:\?\.|\.)\s*fetch|(?<![.\w])fetch)\s*\(/g;
/** An absolute address in a string, as a template or a plain literal gives it. */
const ABSOLUTE_URL = /(https?|wss?):\/\/([^\s"'`)]+)/g;
/** The source files that a package ships: no tests, declarations or installed packages. */
const SOURCE = /\.(?:[cm]?[jt]s)$/;
const NOT_SHIPPED = /\.test\.[cm]?[jt]s$|\.d\.[cm]?ts$/;

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

/** The folders whose shipped files the check reads, relative to the repository root. */
export function checkedFolders(root: string): string[] {
	const packages = readdirSync(join(root, 'packages')).map((name) => join(root, 'packages', name));
	const folders = packages.map((folder) => join(folder, 'src'));
	folders.push(...packages.map((folder) => join(folder, 'bin')));
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
	for (const file of checkedFolders(root).flatMap(sourceFiles)) {
		if (seen.has(file)) continue;
		seen.add(file);
		files++;
		const path = relative(root, file).split(sep).join('/');
		const text = readFileSync(file, 'utf8');
		for (const [name, pattern] of FORBIDDEN_APIS) {
			if (pattern.test(text)) problems.push(`${path}: uses ${name}, which reaches the network`);
		}
		const site = FETCH_SITES[path];
		const found = text.match(new RegExp(FETCH_CALL, 'g'))?.length ?? 0;
		calls += found;
		if (found > 0 && !site)
			problems.push(
				`${path}: calls fetch, and no entry in network-use.ts says what it downloads. Add one with the reason, and say so in docs/getting-started/network-use.md`,
			);
		if (site && found !== site.count)
			problems.push(
				`${path}: has ${found} fetch calls, and network-use.ts records ${site.count}. Update the record and the network use page`,
			);
		for (const match of text.matchAll(ABSOLUTE_URL)) {
			const scheme = match[1] ?? '';
			const host = (match[2] ?? '').split('/')[0] ?? '';
			if (!allowedHost(host))
				problems.push(
					`${path}: names ${scheme}://${host}, which is not a recorded example, link or local name`,
				);
		}
	}
	return { problems, files, calls };
}
