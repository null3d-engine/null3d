// A page whose engine files come from another origin, as from a CDN: the production build of the
// KTX2 page, with its HTML served from the page's origin and every build file from another one.
// Each engine worker then starts from a blob: bootstrap that imports its script from there. The
// page starts under the policy and headers that the hosting guide states, threaded with the
// isolation headers and single-threaded without them, and loads a meshopt glTF file and KTX2 files.
// With an item of the policy or a header missing, the start fails with the code that names it.
// One page loads the terrain add-on's packed library from there: the compiled shader module and the
// files of its builds, which a browser reaches as modules over the CDN's origin. The add-on that
// draws from the CDN build itself is `cdn-script-tag.spec.ts`, on every GPU path.
import { existsSync, readFileSync } from 'node:fs';
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
	`worker-src 'self' blob: ${CDN}`,
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

/**
 * The terrain add-on's packed library, which the test serves as part of the CDN: the pack compiled
 * its shader, so the page imports a module of compiled output rather than a `.wgsl` file.
 */
const ADDON_LIB = join(REPO_ROOT, 'packages/terrain/lib');

/** The path on the CDN where the add-on's library sits. */
const ADDON_PREFIX = '/addons/terrain/lib/';

/** The page that loads the add-on's compiled shader, and its script, which the page's origin serves. */
const ADDON_PAGE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>null3d test: an add-on from a CDN</title>
	</head>
	<body>
		<script type="module" src="/cdn-addon.js"></script>
	</body>
</html>
`;

const ADDON_SCRIPT = `// Imports the add-on's compiled shader from the CDN, and one set of builds for each GPU path, so
// the page proves that a browser reaches the packed files over another origin.
const cdn = new URLSearchParams(location.search).get('cdn');
const report = (value) => {
	window.__null3dResult = value;
};
try {
	const module = await import(cdn + '/addons/terrain/lib/terrain.wgsl.js');
	const shader = module.default;
	const sets = {};
	for (const [target, set] of [['wgsl', 0], ['glsl', 2]]) {
		sets[target + ' ' + set] = Object.keys(await shader.builds(target, set)).length;
	}
	report({
		kind: shader.kind,
		functions: shader.functions,
		uniforms: shader.uniforms.map((uniform) => uniform.name),
		sets,
	});
} catch (error) {
	report({ error: String(error) });
}
`;

/** The page's own files, by the path that the page's origin serves them at. */
const OWN_FILES: Readonly<Record<string, { type: string; body: string }>> = {
	'/cdn-addon.html': { type: 'text/html', body: ADDON_PAGE },
	'/cdn-addon.js': { type: 'text/javascript', body: ADDON_SCRIPT },
};

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
	if (!existsSync(join(ADDON_LIB, 'terrain.wgsl.js')))
		throw new Error(
			`the terrain add-on's library is not built. Run bun tools/build-package.ts terrain first, which compiles its shader.`,
		);
	server = createServer((request, response) => {
		const address = new URL(request.url ?? '/', `http://${request.headers.host}`);
		try {
			const pathname = decodeURIComponent(address.pathname);
			if (address.origin === PAGE) {
				const own = OWN_FILES[pathname];
				const { body, headers } = own
					? {
							body: own.body,
							headers: {
								'content-type': own.type,
								'content-security-policy': hosting.policy,
								...(hosting.isolated ? ISOLATION_HEADERS : {}),
							},
						}
					: pageResponse();
				for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
				response.end(body);
				return;
			}
			const file = pathname.startsWith(ADDON_PREFIX)
				? join(ADDON_LIB, pathname.slice(ADDON_PREFIX.length))
				: join(BUILD, pathname);
			const body = readFileSync(file);
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

/** What the add-on's page reported: its compiled shader, or why it did not load. */
interface AddonResult {
	readonly error?: string;
	readonly kind?: string;
	readonly functions?: readonly string[];
	readonly uniforms?: readonly string[];
	/** The number of builds that each GPU path's set held. */
	readonly sets?: Readonly<Record<string, number>>;
}

test("a page loads an add-on's compiled shader from a CDN", async ({ page }) => {
	hosting = { policy: CDN_POLICY, isolated: true };
	const violations: string[] = [];
	page.on('console', (message) => {
		if (/Content.Security.Policy/i.test(message.text())) violations.push(message.text());
	});
	await page.goto(`${PAGE}/cdn-addon.html?cdn=${CDN}`);
	const result = await pageResult<AddonResult>(page, 60_000);
	expect(result.error).toBeUndefined();
	expect(result.kind).toBe('material');
	expect(result.functions).toContain('surface');
	expect(result.uniforms).toContain('tiles');
	// The shader keeps its builds in files of their own, which load on first use from the CDN too.
	expect(result.sets?.['wgsl 0'] ?? 0).toBeGreaterThan(0);
	expect(result.sets?.['glsl 2'] ?? 0).toBeGreaterThan(0);
	expect(violations).toEqual([]);
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
