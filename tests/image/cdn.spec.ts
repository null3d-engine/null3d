// A page whose engine files come from another origin, as from a CDN: the production build of the
// KTX2 page, with its HTML served from the page's origin and every build file from another one.
// Each engine worker then starts from a blob: bootstrap that imports its script from there. The
// page starts under the policy and headers that the hosting guide states, threaded with the
// isolation headers and single-threaded without them, and loads a meshopt glTF file and KTX2 files.
// With an item of the policy or a header missing, the start fails with the code that names it.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ISOLATION_HEADERS } from '../../packages/vite-plugin/src/index.ts';
import { pageResult } from '../lib/page-result.ts';
import { PREVIEW_PORT, REPO_ROOT } from '../lib/server.ts';

/**
 * The port of the test's own server: the one after the preview server's. It answers for the page's
 * origin and for the CDN's, which differ in their host names.
 */
const PORT = PREVIEW_PORT + 1;
/** The page's origin, where the production build's HTML comes from. */
const PAGE = `http://localhost:${PORT}`;
/** The other origin, which stands in for a CDN. */
const CDN = `http://127.0.0.1:${PORT}`;

/**
 * The policy that the hosting guide states for engine files from a CDN. The test page's small
 * texture files become data: addresses in the build, as Vite makes of a project's small files, so
 * the page's own connect-src allows data: too.
 */
const CDN_POLICY = [
	"default-src 'self'",
	`script-src 'self' ${CDN} 'wasm-unsafe-eval'`,
	"worker-src 'self' blob:",
	`connect-src 'self' ${CDN} data:`,
	"style-src 'self' 'unsafe-inline'",
].join('; ');

interface Hosting {
	/** The page's Content-Security-Policy. */
	policy?: string;
	/** False to leave out the isolation headers. */
	isolated?: boolean;
	/** The CDN's files that come without a CORS header. */
	withoutCors?: RegExp;
}

/** Where the production build of the test pages is. */
const BUILD = join(REPO_ROOT, 'target/production-pages');

/** The media type of each kind of build file. */
const TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.wasm': 'application/wasm',
	'.ktx2': 'image/ktx2',
	'.glb': 'model/gltf-binary',
};

/** How the running test hosts the page and the CDN. */
let hosting: Required<Omit<Hosting, 'withoutCors'>> & Hosting = {
	policy: CDN_POLICY,
	isolated: true,
};

/**
 * The page's response: the KTX2 page's HTML with its addresses of build files on the CDN, with the
 * running test's policy and headers.
 */
function pageResponse(): { body: string; headers: Record<string, string> } {
	const html = readFileSync(join(BUILD, 'tests/pages/ktx2-files.html'), 'utf8');
	return {
		body: html.replaceAll('"/assets/', `"${CDN}/assets/`),
		headers: {
			'content-type': 'text/html',
			'content-security-policy': hosting.policy,
			...(hosting.isolated ? ISOLATION_HEADERS : {}),
		},
	};
}

/**
 * The test's server. A real server lets the browser apply its CORS rules and its rules for local
 * addresses as it does on the web, which a response that the test fulfills in the browser would not.
 * It serves the page's HTML under the page's host name, and the build's files under the CDN's,
 * with a CORS header unless the running test leaves it out.
 */
let server: Server | undefined;

test.beforeAll(async () => {
	server = createServer((request, response) => {
		const address = new URL(request.url ?? '/', `http://${request.headers.host}`);
		try {
			if (address.origin === PAGE) {
				const { body, headers } = pageResponse();
				for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
				response.end(body);
				return;
			}
			const body = readFileSync(join(BUILD, decodeURIComponent(address.pathname)));
			response.setHeader(
				'content-type',
				TYPES[extname(address.pathname)] ?? 'application/octet-stream',
			);
			if (!hosting.withoutCors?.test(address.pathname))
				response.setHeader('access-control-allow-origin', '*');
			response.end(body);
		} catch {
			response.statusCode = 404;
			response.end();
		}
	});
	await new Promise<void>((resolve) => server?.listen(PORT, resolve));
});

test.afterAll(
	() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
);

/** What the decoders sketch reports, with the engine's mode. */
interface CdnResult {
	error?: string;
	mode: { build: string };
	recorded: { bounds: number[]; formats: string[] };
}

/** Opens the page with the hosting that `changes` give, and returns its result. */
async function openOnCdn(page: Page, query: string, changes: Hosting = {}): Promise<CdnResult> {
	hosting = { policy: CDN_POLICY, isolated: true, ...changes };
	await page.goto(`${PAGE}/tests/pages/ktx2-files.html?gpu=webgl2&decoders&${query}`);
	return pageResult<CdnResult>(page, 60_000);
}

for (const [name, query, build] of [
	['threaded', '', 'threaded'],
	['single-threaded', 'threads=off', 'single'],
] as const)
	test(`a page starts with its engine files on a CDN under the stated policy, ${name}`, async ({
		page,
	}) => {
		const violations: string[] = [];
		page.on('console', (message) => {
			if (/Content.Security.Policy/i.test(message.text())) violations.push(message.text());
		});
		const result = await openOnCdn(page, query);
		expect(result.error).toBeUndefined();
		expect(result.mode.build).toBe(build);
		expect(result.recorded.formats).toHaveLength(8);
		expect(result.recorded.bounds.some((v) => v !== 0)).toBe(true);
		expect(violations).toEqual([]);
	});

test('a page on a CDN without the isolation headers starts single-threaded', async ({ page }) => {
	const result = await openOnCdn(page, '', { isolated: false });
	expect(result.error).toBeUndefined();
	expect(result.mode.build).toBe('single');
});

/** Each item of the policy or a header that the CDN needs, left out, and the error it gives. */
const MISSING: readonly { item: string; hosting: Hosting; error: RegExp }[] = [
	{
		item: 'blob: in worker-src',
		hosting: { policy: CDN_POLICY.replace(' blob:', '') },
		error:
			/^E1422: the page's Content-Security-Policy blocks the [a-z-]+ worker: its worker-src does not allow blob:/,
	},
	{
		item: 'the CDN in connect-src',
		hosting: { policy: CDN_POLICY.replace(` ${CDN} data:`, ' data:') },
		error: new RegExp(
			`^E1422: the page's Content-Security-Policy blocks the threaded engine core from ${CDN}: its connect-src does not allow it\\.`,
		),
	},
	{
		item: "'wasm-unsafe-eval'",
		hosting: { policy: CDN_POLICY.replace(" 'wasm-unsafe-eval'", '') },
		error:
			/^E1418: the page's Content-Security-Policy does not let the threaded engine core compile: /,
	},
	{
		item: 'CORS on the .wasm files',
		hosting: { withoutCors: /\.wasm$/ },
		error: new RegExp(
			`^E1423: the threaded engine core from ${CDN} came without a CORS header, or did not download`,
		),
	},
	{
		item: "CORS on the workers' scripts",
		hosting: { withoutCors: /\/(sketch|render|job|probe)-worker-[\w-]{8}\.js$/ },
		error: new RegExp(
			`^E1423: the [a-z-]+ worker's script from ${CDN} came without a CORS header, or did not download\\.`,
		),
	},
];

for (const { item, hosting, error } of MISSING)
	test(`a page on a CDN without ${item} gives the error that names it`, async ({ page }) => {
		const result = await openOnCdn(page, '', hosting);
		expect(result.error ?? '').toMatch(error);
	});
