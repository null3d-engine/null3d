// A page that is a single HTML file, with no bundler: it imports the engine's built files from
// another origin, as a CDN serves them, and draws a scene. The build under target/cdn holds what
// tools/build-cdn.ts writes: the engine package's built JavaScript, its shader modules, both
// WebAssembly builds and the vendor files. The page runs in both thread modes that the build
// supports: single-threaded without the isolation headers, as a page on a site that cannot send
// them, and threaded with them.

import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ISOLATION_HEADERS } from '../../packages/vite-plugin/src/index.ts';
import { buildCdn } from '../../tools/lib/cdn.ts';
import { REPO_ROOT } from '../lib/server.ts';

/** Where the CDN build is written, and the folder whose files the CDN origin serves. */
const BUILD = join(REPO_ROOT, 'target/cdn');
/** The page's file, which the page's origin serves as it is. */
const PAGE_FILE = join(REPO_ROOT, 'tests/pages/cdn-try.html');

/** The policy that a page of inline scripts needs, with the engine's files on the CDN. */
function policy(cdn: string): string {
	return [
		"default-src 'self'",
		`script-src 'self' 'unsafe-inline' blob: ${cdn} 'wasm-unsafe-eval'`,
		`worker-src 'self' blob: ${cdn}`,
		`connect-src 'self' ${cdn}`,
		"style-src 'self' 'unsafe-inline'",
	].join('; ');
}

/** The media type of each kind of build file. */
const TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.wasm': 'application/wasm',
	'.bin': 'application/octet-stream',
};

/** What the page reports after it draws. */
interface CdnTryResult {
	error?: string;
	build: 'single' | 'threaded';
	threaded: boolean;
	/** True when the page imported the engine through its import map. */
	mapped: boolean;
	width: number;
	height: number;
	/** The red, green, blue and alpha of the pixel at the canvas's center. */
	center: [number, number, number, number];
}

let server: Server | undefined;
let pageOrigin = '';
let cdnOrigin = '';

test.beforeAll(async () => {
	test.setTimeout(15 * 60_000);
	// No other step makes this build, so the test makes it here, or finds the one that an earlier run
	// made up to date.
	buildCdn(REPO_ROOT, BUILD);
	// One server answers for both hosts on one port, so the page and the CDN differ in their origin
	// as they do on the web.
	server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
		try {
			if (url.origin === pageOrigin) {
				response.setHeader('content-type', 'text/html');
				response.setHeader('content-security-policy', policy(cdnOrigin));
				for (const [name, value] of Object.entries(headersOf(url.searchParams.get('threaded'))))
					response.setHeader(name, value);
				response.end(readFileSync(PAGE_FILE));
				return;
			}
			const body = readFileSync(join(BUILD, decodeURIComponent(url.pathname)));
			response.setHeader(
				'content-type',
				TYPES[url.pathname.slice(url.pathname.lastIndexOf('.'))] ?? 'application/octet-stream',
			);
			response.setHeader('access-control-allow-origin', '*');
			response.end(body);
		} catch {
			response.statusCode = 404;
			response.end();
		}
	});
	await new Promise<void>((resolve) => server?.listen(0, resolve));
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('the server gave no port');
	pageOrigin = `http://localhost:${address.port}`;
	cdnOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(
	() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
);

/** The headers that let a page's threads share memory, for a run that asks for them. */
function headersOf(threaded: string | null): Record<string, string> {
	return threaded === '1' ? { ...ISOLATION_HEADERS } : {};
}

/** Opens the page with the CDN folder as the query names it, and returns what it reports. */
async function open(page: Page, threaded: boolean, mapped = false): Promise<CdnTryResult> {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const query = new URLSearchParams({ cdn: `${cdnOrigin}/` });
	if (threaded) query.set('threaded', '1');
	if (mapped) query.set('map', '1');
	await page.goto(`${pageOrigin}/?${query}`);
	await page.waitForFunction(
		() => 'cdnTry' in globalThis || 'cdnTryError' in globalThis,
		undefined,
		{ timeout: 120_000 },
	);
	const reported = (await page.evaluate(() => {
		const page = globalThis as unknown as { cdnTry?: CdnTryResult; cdnTryError?: string };
		return page.cdnTry ?? { error: page.cdnTryError };
	})) as CdnTryResult;
	const failure = errors.length > 0 ? errors.join('; ') : reported.error;
	return failure === undefined ? reported : { ...reported, error: failure };
}

for (const [name, threaded, mapped, build] of [
	['single-threaded, with no isolation headers', false, false, 'single'],
	['threaded, with the isolation headers', true, false, 'threaded'],
	['single-threaded, through an import map', false, true, 'single'],
] as const)
	test(`a single HTML file draws a scene from the CDN, ${name}`, async ({ page }) => {
		test.setTimeout(3 * 60_000);
		const result = await open(page, threaded, mapped);
		console.log(`cdn-script-tag ${name}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.build).toBe(build);
		expect(result.threaded).toBe(threaded);
		expect(result.mapped).toBe(mapped);
		expect(result.width * result.height).toBeGreaterThan(0);
		// The box covers the center of the frame: its orange, not the dark background.
		const [red, green, blue, alpha] = result.center;
		expect(red).toBeGreaterThan(100);
		expect(red).toBeGreaterThan(blue + 40);
		expect(green).toBeGreaterThan(blue);
		expect(alpha).toBeGreaterThan(200);
	});
