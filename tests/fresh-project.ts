// The packed packages in a fresh project, as a developer installs them from npm. It packs every
// public package as the publish job does, makes a new Vite project in a temporary folder outside
// the repository, so that no file of the repository can stand in for a missing one, and installs
// the tarballs there with Bun. In that project it runs the command-line tool's test command twice:
// once to keep the images of the first run as the references, then once to match them. The test
// command type checks the project against the packages' declarations, and draws the project's
// sketch on every GPU tier. Then the tool optimizes a model, and last, it builds the project for
// production. The build must hold the engine's third-party notices, and its page must start the
// threaded engine in a browser under a strict Content-Security-Policy, whatever test switches the
// address holds. Last, the project's service worker caches the build on a first visit, and the
// page must start the threaded engine again with the server stopped, on both GPU paths. Then the
// project builds a page of its own layout around a copy of this repository's examples folder, as a
// website that holds the repository as a submodule does, and two demos must start from that build.
// Run
// `bun run build` first, for the WebAssembly files. Run from the repository root:
//   bun run test:packages [--keep]    --keep leaves the project's folder in place after a pass
import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultEnvironment, launchBrowser } from '../packages/cli/src/browser.js';
import {
	FILES_LIST,
	ISOLATION_HEADERS,
	NOTICES_FILE,
	type OfflineFiles,
} from '../packages/vite-plugin/src/index.ts';
import { DEFAULT_PACK_DIR, type PackedPackage, packPackages } from '../tools/lib/packages.ts';
import { ASSET_SCENE } from './lib/asset-scene.ts';
import { STRICT_POLICY } from './lib/content-security-policy.ts';

const ROOT = join(import.meta.dirname, '..');
/** The project's files besides its package manifest. */
const TEMPLATE = join(ROOT, 'tests/fixtures/fresh-project');
/** The packages that the project's page and sketch import. */
const DEPENDENCIES = ['@null3d/engine', '@null3d/controls'];
/** The packages that the project's tools run. */
const DEV_DEPENDENCIES = ['@null3d/vite-plugin', '@null3d/cli'];
/** Tools from npm, at the versions that the repository pins. */
const TOOLS = ['vite', 'typescript'];

/** The project's package manifest, with each package from its tarball. */
export function projectManifest(
	packed: readonly PackedPackage[],
	pinned: Readonly<Record<string, string>>,
): object {
	const tarball = (name: string) => {
		const found = packed.find((pkg) => pkg.name === name);
		if (!found) throw new Error(`${name} was not packed; is it private?`);
		return `file:${found.tarball}`;
	};
	const versions = (names: readonly string[], version: (name: string) => string) =>
		Object.fromEntries(names.map((name) => [name, version(name)]));
	return {
		name: 'null3d-fresh-project',
		private: true,
		type: 'module',
		// npm may not have the packed version of a package that another one names, such as the
		// engine that the controls name, so every copy comes from its tarball.
		overrides: versions([...DEPENDENCIES, ...DEV_DEPENDENCIES], tarball),
		dependencies: versions(DEPENDENCIES, tarball),
		devDependencies: {
			...versions(DEV_DEPENDENCIES, tarball),
			...versions(TOOLS, (name) => {
				const version = pinned[name];
				if (!version) throw new Error(`the repository's package.json pins no ${name}`);
				return version;
			}),
		},
	};
}

/** Runs a command in the project's folder with its output shown, and fails when it fails. */
function step(
	title: string,
	cwd: string,
	command: string,
	args: readonly string[],
	env: Record<string, string> = {},
): void {
	console.log(`\n${title}: ${command} ${args.join(' ')}`);
	const result = spawnSync(command, args, {
		cwd,
		stdio: 'inherit',
		env: { ...process.env, ...env },
	});
	if (result.status !== 0)
		throw new Error(`${title} failed with ${result.error?.message ?? `status ${result.status}`}`);
}

/** A browser page, as the command-line tool's browser opens it. */
type Page = Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['newPage']>>;

/** The page's globals that the checks read, typed, as this file's Node settings lack them. */
type PageGlobals = {
	document: { documentElement: { dataset: { start?: string; demo?: string; tier?: string } } };
	crossOriginIsolated: boolean;
	navigator: { serviceWorker: { ready: Promise<unknown> } };
	caches: {
		keys(): Promise<string[]>;
		open(name: string): Promise<{ keys(): Promise<{ url: string }[]> }>;
	};
};

/**
 * Serves a production build with the isolation headers and, unless `strict` is false, the strict
 * policy on every file, as a strict host does. A worker takes the policy of its own script's
 * response, so every file carries it.
 */
function serveBuild(dist: string, strict = true) {
	const headers = {
		...ISOLATION_HEADERS,
		...(strict ? { 'Content-Security-Policy': STRICT_POLICY } : {}),
	};
	return Bun.serve({
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			const file = Bun.file(join(dist, path === '/' ? 'index.html' : path));
			return (await file.exists())
				? new Response(file, { headers: { ...headers, 'Content-Type': file.type } })
				: new Response('not found', { status: 404, headers });
		},
	});
}

/**
 * Waits for the page's start, and returns how it ended: the build that started, or the error.
 * Functions, not text: Playwright evaluates text with eval, which the strict policy blocks.
 */
async function startOf(
	page: Page,
): Promise<{ start: string | undefined; isolated: boolean; tier: string | undefined }> {
	const start = await page
		.waitForFunction(
			() => (globalThis as unknown as PageGlobals).document.documentElement.dataset.start,
			undefined,
			{ timeout: 30_000 },
		)
		.then((handle) => handle.jsonValue());
	const isolated = await page.evaluate(
		() => (globalThis as unknown as PageGlobals).crossOriginIsolated,
	);
	const tier = await page.evaluate(
		() => (globalThis as unknown as PageGlobals).document.documentElement.dataset.tier,
	);
	return { start, isolated, tier };
}

/**
 * Fails unless the build's page starts the engine with threads and no file breaks the strict
 * policy. The address asks for the single-threaded build, which a shipped game must ignore.
 */
async function startsUnderStrictPolicy(dist: string): Promise<void> {
	console.log('\nStart under a strict Content-Security-Policy');
	const server = serveBuild(dist);
	const browser = await launchBrowser(defaultEnvironment());
	try {
		const page = await browser.newPage();
		const violations: string[] = [];
		page.on('console', (message) => {
			if (/Content.Security.Policy/i.test(message.text())) violations.push(message.text());
		});
		await page.goto(`${server.url.href}?threads=off`);
		const { start, isolated } = await startOf(page);
		if (start !== 'threaded' || !isolated || violations.length > 0)
			throw new Error(
				`under a strict policy, with ?threads=off in the address, the page did not start the threaded engine: start ${start}, isolated ${isolated}, policy reports ${JSON.stringify(violations)}`,
			);
	} finally {
		await browser.close();
		server.stop(true);
	}
}

/**
 * The project's service worker caches the page and the files of the build's list on the first
 * visit. Then the server stops, and the page must load again from the cache alone: isolated, with
 * the threaded engine and the sprite shaders that it preloads, and with no failed request but the
 * worker's own check of the list. The cache must hold the page, the start's files and the sprite
 * feature's, and no other feature's. The start holds the renderers of both GPU paths, and the
 * page must also start offline on the path that its first visit did not draw with.
 */
async function playsOffline(dist: string): Promise<void> {
	console.log('\nPlay offline after the first visit');
	const list = JSON.parse(readFileSync(join(dist, FILES_LIST), 'utf8')) as OfflineFiles;
	const sprites = list.features.sprites ?? [];
	if (sprites.length === 0 || list.start.some((file) => /shaders-sprites-/.test(file)))
		throw new Error(`${FILES_LIST} does not list the sprite shaders as a feature of their own`);
	for (const path of ['webgpu', 'webgl2'])
		if (!list.start.some((file) => new RegExp(`/${path}-renderers-[\\w-]+\\.js$`).test(file)))
			throw new Error(`${FILES_LIST} leaves the ${path} renderers out of the start`);
	const server = serveBuild(dist);
	const browser = await launchBrowser(defaultEnvironment());
	try {
		const page = await browser.newPage();
		await page.goto(server.url.href);
		const first = await startOf(page);
		if (first.start !== 'threaded' || !first.isolated)
			throw new Error(`the first visit did not start the threaded engine: ${first.start}`);
		const cached = await page.evaluate(async () => {
			const { navigator, caches } = globalThis as unknown as PageGlobals;
			await navigator.serviceWorker.ready;
			const names = await caches.keys();
			const keys = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
			return keys.flat().map((request) => new URL(request.url).pathname.slice(1));
		});
		const expected = ['', ...list.start, ...sprites].sort();
		if (JSON.stringify(cached.sort()) !== JSON.stringify(expected))
			throw new Error(
				`the service worker cached ${cached.length} files, not the ${expected.length} of the page, the start and the sprites`,
			);
		server.stop(true);
		const failed: string[] = [];
		// The worker's check for a newer build fails offline, as it should, and changes nothing.
		page.context().on('requestfailed', (request) => {
			if (!request.url().endsWith(`/${FILES_LIST}`)) failed.push(request.url());
		});
		await page.reload();
		const offline = await startOf(page);
		if (offline.start !== 'threaded' || !offline.isolated || failed.length > 0)
			throw new Error(
				`offline, the page did not start the threaded engine from the cache alone: start ${offline.start}, isolated ${offline.isolated}, failed requests ${JSON.stringify(failed)}`,
			);
		// The first visit drew with one GPU path. The cache must also start the other, which a
		// device that changes its GPU or browser between visits takes.
		if (first.tier === 'webgl2') {
			console.log('  this browser has no WebGPU, so the offline start on WebGPU is not checked');
			return;
		}
		await page.goto(`${server.url.href}?path=webgl2`);
		const other = await startOf(page);
		if (other.start !== 'threaded' || other.tier !== 'webgl2' || failed.length > 0)
			throw new Error(
				`offline, the page did not start on the GPU path that its first visit did not draw with: start ${other.start}, path ${other.tier}, failed requests ${JSON.stringify(failed)}`,
			);
		console.log(`  started offline on ${first.tier} and on webgl2`);
	} finally {
		await browser.close();
		server.stop(true);
	}
}

/** The demos that the website's build must start: ones that make their content in code. */
const BUILT_DEMOS = ['instances', 'security-camera'];

/**
 * A website's page that shows one demo in a layout of its own. It imports only the list of demos
 * and the function that starts one, as the website does, and marks the root element with how the
 * start ended.
 */
const SITE_PAGE = {
	'index.html': [
		'<!doctype html>',
		'<html lang="en">',
		'\t<head><meta charset="utf-8" /><title>Demo</title></head>',
		'\t<body><h1></h1><canvas width="640" height="360"></canvas>',
		'\t\t<script type="module" src="./main.ts"></script></body>',
		'</html>',
		'',
	],
	'main.ts': [
		"import { DEMOS } from '../null3d/examples/demos';",
		"import { startDemo } from '../null3d/examples/lib/run';",
		'',
		"const name = new URLSearchParams(location.search).get('demo');",
		'const demo = DEMOS.find((candidate) => candidate.name === name);',
		'const root = document.documentElement;',
		"if (!demo) root.dataset.demo = 'no demo named ' + name;",
		'else {',
		"\t(document.querySelector('h1') as HTMLElement).textContent = demo.title;",
		"\tconst canvas = document.querySelector('canvas') as HTMLCanvasElement;",
		'\tstartDemo({ canvas, demo }).then(',
		"\t\t() => (root.dataset.demo = 'running'),",
		'\t\t(error) => (root.dataset.demo = String(error)),',
		'\t);',
		'}',
		'',
	],
	'vite.config.ts': [
		"import null3d from '@null3d/vite-plugin';",
		"import { defineConfig } from 'vite';",
		'',
		'export default defineConfig({',
		"\tbase: './',",
		'\tplugins: [null3d({ urlSwitches: true })],',
		"\tresolve: { dedupe: ['@null3d/engine', '@null3d/controls'] },",
		"\tbuild: { outDir: '../dist-site', emptyOutDir: true },",
		'});',
		'',
	],
};

/**
 * Builds a website's page of its own layout around a copy of the repository's examples folder, as
 * a website does that holds the repository as a submodule and installs the packages from npm. The
 * build takes the packages from the project's tarballs, and each demo of BUILT_DEMOS must start.
 */
async function buildsExamples(project: string): Promise<void> {
	const copy = join(project, 'null3d');
	cpSync(join(ROOT, 'examples'), join(copy, 'examples'), {
		recursive: true,
		filter: (source) => !source.includes('node_modules'),
	});
	copyFileSync(join(ROOT, 'tsconfig.web.base.json'), join(copy, 'tsconfig.web.base.json'));
	const site = join(project, 'site');
	mkdirSync(site);
	for (const [file, lines] of Object.entries(SITE_PAGE))
		writeFileSync(join(site, file), lines.join('\n'));
	step(
		'Build a website page of the demos',
		site,
		join(project, 'node_modules/.bin/vite'),
		['build'],
		{
			VITE_NULL3D_SAMPLES_BASE: './samples/',
		},
	);
	console.log('\nStart demos from the website build');
	const server = serveBuild(join(project, 'dist-site'), false);
	const browser = await launchBrowser(defaultEnvironment());
	try {
		const page = await browser.newPage();
		for (const demo of BUILT_DEMOS) {
			// The Low preset keeps a demo's start short on a software GPU; the check is that it starts.
			await page.goto(`${server.url.href}?demo=${demo}&preset=low`);
			const state = await page
				.waitForFunction(
					() => (globalThis as unknown as PageGlobals).document.documentElement.dataset.demo,
					undefined,
					{ timeout: 60_000 },
				)
				.then((handle) => handle.jsonValue());
			if (state !== 'running')
				throw new Error(`the website build did not start the ${demo} demo: ${state}`);
		}
	} finally {
		await browser.close();
		server.stop(true);
	}
}

async function main(): Promise<void> {
	const keep = process.argv.includes('--keep');
	console.log('Packing the public packages');
	const packed = packPackages(ROOT, join(ROOT, DEFAULT_PACK_DIR));
	for (const { name, version, tarball } of packed) console.log(`  ${name}@${version}: ${tarball}`);

	const project = mkdtempSync(join(tmpdir(), 'null3d-fresh-project-'));
	console.log(`\nThe fresh project: ${project}`);
	let passed = false;
	try {
		cpSync(TEMPLATE, project, { recursive: true });
		const pinned = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies;
		writeFileSync(
			join(project, 'package.json'),
			`${JSON.stringify(projectManifest(packed, pinned), null, '\t')}\n`,
		);
		step('Install', project, 'bun', ['install']);
		// The installed command, as `bunx @null3d/cli` runs it in a project that installs the tool.
		const cli = join(project, 'node_modules/.bin/null3d');
		step('Keep the first images as references', project, cli, ['test', '--update-references']);
		step('Match the references', project, cli, ['test']);
		// The asset tool from the tarball: its encoder, its worker and its dependencies.
		mkdirSync(join(project, 'models'));
		copyFileSync(join(ROOT, ASSET_SCENE.source), join(project, 'models/scene.glb'));
		step('Optimize a model', project, cli, ['assets', 'optimize', 'models', 'public/models']);
		const textures = readdirSync(join(project, 'public/models/textures'));
		if (!existsSync(join(project, 'public/models/scene.glb')) || textures.length !== 3)
			throw new Error(`the asset tool wrote ${textures.length} textures, not 3, or no model`);
		step('Production build', project, join(project, 'node_modules/.bin/vite'), ['build']);
		// The threaded core and the single-threaded one.
		const cores = readdirSync(join(project, 'dist/assets')).filter((file) =>
			/^null3d_bg-[\w-]+\.wasm$/.test(file),
		);
		if (cores.length !== 2)
			throw new Error(`the production build holds ${cores.length} engine cores, not 2`);
		const notices = join(project, 'dist', NOTICES_FILE);
		const engineNotices = readFileSync(
			join(ROOT, 'packages/engine/THIRD-PARTY-NOTICES.txt'),
			'utf8',
		);
		if (!existsSync(notices) || readFileSync(notices, 'utf8') !== engineNotices)
			throw new Error(`the production build lacks the engine's notices in ${NOTICES_FILE}`);
		await startsUnderStrictPolicy(join(project, 'dist'));
		await playsOffline(join(project, 'dist'));
		await buildsExamples(project);
		passed = true;
		console.log(`\nThe packed packages pass in a fresh project (${packed.length} packages).`);
	} finally {
		if (passed && !keep) rmSync(project, { recursive: true, force: true });
		else console.log(`The project stays in ${project}.`);
	}
}

if (import.meta.main) {
	try {
		await main();
	} catch (e) {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	}
}
