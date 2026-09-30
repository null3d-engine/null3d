// Addresses for startup measurements. Each load of the engine test page's production build gets a
// path prefix, which the server strips: a cold load uses a prefix the browser has never seen, so no
// cache holds any of its files, and warm loads repeat the prefix of an earlier load. The server, in
// Node, and the runner page, in the browser, share these helpers, so they use no API of either.

/** Where the server serves a load's files: then the kind of load, its key and the file's path. */
export const LOAD_ROUTE = '/__null3d/load/';
/** Where the server tells what it sent for a load since the last time it was asked, then forgets it. */
export const DOWNLOADS_ROUTE = '/__null3d/downloads/';
/** Where the server prepares every file of the build, and says whether it has a build to serve. */
export const LOAD_READY_ROUTE = '/__null3d/load-ready';

/**
 * A cold load's files must be new to the browser, so the server makes its core differ from every
 * other load's. A warm load's files stay the same, so the browser can keep them.
 */
export const LOAD_KINDS = ['cold', 'warm'] as const;
export type LoadKind = (typeof LOAD_KINDS)[number];

/** A load: its kind and its key, which names its path prefix. */
export interface Load {
	kind: LoadKind;
	key: string;
}

/** A key: safe in a path and as a name, and never a step out of the build's folder. */
const KEY = /^[a-z0-9][a-z0-9._-]*$/;
/** A file's path in the build: plain names and folders, so it cannot leave the build's folder. */
const BUILD_PATH = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

const isKind = (text: string | undefined): text is LoadKind =>
	(LOAD_KINDS as readonly string[]).includes(text ?? '');

/** The address of a file of the build for a load, such as `tests/pages/engine.html?seconds=1`. */
export function loadPath({ kind, key }: Load, path: string): string {
	return `${LOAD_ROUTE}${kind}/${key}/${path}`;
}

/**
 * The load and the file an address asks for, with the file's path in the build and without its
 * query; undefined for an address outside the load route, or for a key or path the server refuses.
 */
export function parseLoadPath(url: string): (Load & { path: string }) | undefined {
	if (!url.startsWith(LOAD_ROUTE)) return undefined;
	const [kind, key, ...rest] = (url.slice(LOAD_ROUTE.length).split(/[?#]/)[0] as string).split('/');
	const path = rest.join('/');
	if (!isKind(kind) || !KEY.test(key ?? '') || !BUILD_PATH.test(path)) return undefined;
	return { kind, key: key as string, path };
}

/** True for an address under the load route, such as a plan item's before the runner fills it in. */
export const isLoadPath = (path: string) => path.startsWith(LOAD_ROUTE);

/** The load whose files an address of a page asks for, or undefined for any other page. */
export function loadOf(url: string): Load | undefined {
	const load = parseLoadPath(url);
	return load && { kind: load.kind, key: load.key };
}

/** The address where the server tells what it sent for a load. */
export function downloadsPath({ kind, key }: Load): string {
	return `${DOWNLOADS_ROUTE}${kind}/${key}`;
}

/** The load an address of the downloads route names, or undefined. */
export function parseDownloadsPath(url: string): Load | undefined {
	if (!url.startsWith(DOWNLOADS_ROUTE)) return undefined;
	const [kind, key, ...rest] = (url.slice(DOWNLOADS_ROUTE.length).split('?')[0] as string).split(
		'/',
	);
	if (!isKind(kind) || !KEY.test(key ?? '') || rest.length > 0) return undefined;
	return { kind, key: key as string };
}

/**
 * A key named `name` that starts with the run and the runner, which the runner page fills in. Each
 * runner then loads under keys of its own, which no earlier run used.
 */
export const runnerKey = (name: string) => `{run}.{runner}.${name}`;

/** A plan item's address with the run and the runner filled in, where it has `{run}` and `{runner}`. */
export function fillRunner(path: string, run: string, runner: string): string {
	return path.replaceAll('{run}', run).replaceAll('{runner}', runner);
}

/**
 * What the server at `base` sent for a load since it was last asked; it then forgets them. `get`
 * fetches, so a tool on this computer can pass one that accepts the local HTTPS certificate.
 */
export async function takeDownloads(
	load: Load,
	base = '',
	get: (url: string) => Promise<Response> = fetch,
): Promise<Downloads> {
	const response = await get(`${base}${downloadsPath(load)}`);
	if (!response.ok)
		throw new Error(
			`the server did not tell the downloads of ${load.key} (HTTP ${response.status})`,
		);
	return (await response.json()) as Downloads;
}

/** One response the server sent for a load. */
export interface DownloadedFile {
	/** The file's path in the build. */
	path: string;
	status: number;
	/** Bytes of the body as sent, after compression. */
	bytes: number;
	/** The compression: br, gzip or identity. */
	encoding: string;
	/** Milliseconds from the load's first request to this one. */
	atMs: number;
}

/** What the server sent for a load: every response, and their count and bytes. */
export interface Downloads {
	requests: number;
	bytes: number;
	files: DownloadedFile[];
}
