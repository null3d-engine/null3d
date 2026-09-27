// The documentation inventory and every file generated from a single source: placeholder pages for
// planned pages, the page list in docs/index.md, and the three.js mapping page with the porting
// skill's copies of the mapping. Generation is computed in memory first, so the same code writes
// the files and checks that the committed files are current.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { docsFiles, readIfExists } from './files';
import { parseFrontMatter, renderFrontMatter } from './frontmatter';
import { checkLinkTree, linkedFiles } from './links';

export interface PageEntry {
	/** Path under docs/ without the .md extension. */
	id: string;
	title: string;
	/** First engine version that ships the page's feature. */
	since: string;
	summary: string;
}

/** Docs areas in reading order, with the heading each gets in the page list. */
export const AREAS: readonly (readonly [id: string, heading: string])[] = [
	['getting-started', 'Getting started'],
	['concepts', 'Concepts'],
	['api', 'API reference'],
	['guides', 'Guides'],
	['shaders', 'Shaders'],
	['porting', 'Porting from three.js'],
	['cli', 'Command-line tool'],
	['errors', 'Errors'],
	['cookbook', 'Cookbook'],
];

export const STATUSES = ['planned', 'experimental', 'stable', 'generated'] as const;

const SINCE_FORMAT = /^(\d+\.\d+|after \d+\.\d+)$/;

/** Every page the docs will have. A page that does not exist yet is generated as a placeholder. */
// biome-ignore format: one page per line keeps the inventory readable as a table
export const PAGES: readonly PageEntry[] = [
	{ id: 'index', title: 'sokko3d documentation', since: '0.1', summary: 'What sokko3d is; how the docs are organized; status labels.' },
	{ id: 'getting-started/install', title: 'Install and create a project', since: '0.3', summary: '`sokko3d create`; packages; engine, docs and skills versions always match.' },
	{ id: 'getting-started/first-scene', title: 'Your first scene', since: '0.1', summary: 'page.ts with createEngine; game.ts with defineGame; camera, light, mesh; running the dev server.' },
	{ id: 'getting-started/hosting', title: 'Hosting and cross-origin isolation', since: '0.1', summary: 'COOP and COEP headers; require-corp on Safari; CORS and CORP for assets; the single-threaded fallback.' },
	{ id: 'getting-started/project-structure', title: 'Project structure', since: '0.3', summary: 'page.ts, game.ts, assets/, AGENTS.md, .claude/skills/; what runs where.' },

	{ id: 'concepts/architecture', title: 'Architecture: threads and the frame', since: '0.1', summary: 'Main thread, game worker, render worker, job workers; the pipelined frame; latency modes.' },
	{ id: 'concepts/handles', title: 'Handles and objects', since: '0.1', summary: '30-bit handles; wrapper objects; stale-handle errors; keeping game data in your own arrays.' },
	{ id: 'concepts/static-dynamic', title: 'Static and dynamic objects', since: '0.1', summary: 'When to mark objects static; setters versus direct array writes; dirty ranges.' },
	{ id: 'concepts/instances', title: 'Instances and batching', since: '0.1', summary: 'createInstances; typed-array views; markDirty; automatic batching; per-instance attributes.' },
	{ id: 'concepts/backends', title: 'GPU tiers and backends', since: '0.1', summary: 'WebGPU core, compatibility mode and WebGL2; capability flags; the portable budget; never branching on GPU names.' },
	{ id: 'concepts/quality-presets', title: 'Quality presets, dynamic resolution and frame budgets', since: '0.1', summary: 'Low to Ultra; pixel-ratio caps; the frame-budget governor; quality events for game code.' },
	{ id: 'concepts/color-management', title: 'Color management', since: '0.1', summary: 'Linear working space; sRGB hex colors; texture color spaces; parity with three.js.' },
	{ id: 'concepts/materials', title: 'Materials and pipelines', since: '0.1', summary: 'Built-in materials; permutations; pipeline warm-up; why changing shader features can stall a frame.' },
	{ id: 'concepts/lighting', title: 'Lighting and environment', since: '0.1', summary: 'Light types and units; clustered lighting; environment maps and spherical harmonics.' },
	{ id: 'concepts/shadows', title: 'Shadows', since: '0.1', summary: 'Cascades; update rates; filtering per preset; bias settings.' },
	{ id: 'concepts/render-layers', title: 'Render layers', since: '0.1', summary: '32-bit layer masks on objects, cameras, raycasts and passes.' },
	{ id: 'concepts/render-graph', title: 'The render graph', since: '0.1', summary: 'Declared reads and writes; automatic order; transient memory; validation errors; the text dump.' },
	{ id: 'concepts/large-worlds', title: 'Large worlds and precision', since: '0.2', summary: 'Cell-relative positions and per-frame camera-to-cell offsets; reversed depth; largeWorld mode; batch origins; floating-origin geometry.' },
	{ id: 'concepts/culling', title: 'Culling', since: '0.1', summary: 'Grid-cell culling; frustum and small-object tests; two-phase GPU occlusion culling on WebGPU; software occlusion culling and blocker meshes on WebGL2 (0.2).' },
	{ id: 'concepts/lod', title: 'Levels of detail', since: '0.2', summary: 'LOD groups; generated LODs; per-instance selection.' },
	{ id: 'concepts/assets', title: 'Assets and prefabs', since: '0.2', summary: 'glTF, KTX2, meshopt; prefabs and instantiate; upload budgets; memory.' },
	{ id: 'concepts/post-processing', title: 'The post-processing chain', since: '0.2', summary: 'HDR target; bloom; ambient occlusion; the single final pass; custom effects.' },

	{ id: 'api/engine', title: 'Page API: createEngine', since: '0.1', summary: 'createEngine options; engine.postToGame, capture, labels, requestPointerLock, capabilities, destroy.' },
	{ id: 'api/game', title: 'Game API: defineGame and the context', since: '0.1', summary: 'The context object: scene, assets, materials, geometry, textures, input, time, quality, post, render, page, ui, debug; the callbacks.' },
	{ id: 'api/scene', title: 'Scene', since: '0.1', summary: 'Creating objects; find; background, environment, fog, sky; warmUp.' },
	{ id: 'api/objects', title: 'Objects and transforms', since: '0.1', summary: 'Setters and getters; parents; flags; destroy.' },
	{ id: 'api/cameras', title: 'Cameras', since: '0.1', summary: 'Perspective and orthographic cameras; screenToRay; worldToScreen; layers.' },
	{ id: 'api/lights', title: 'Lights', since: '0.1', summary: 'Directional, point, spot, hemisphere and ambient lights; shadow options.' },
	{ id: 'api/geometry', title: 'Geometry', since: '0.1', summary: 'Generators with three.js parameters; fromArrays; updateVertices.' },
	{ id: 'api/materials', title: 'Materials', since: '0.1', summary: 'standard, unlit, shader, shadowCatcher; every option.' },
	{ id: 'api/textures', title: 'Textures', since: '0.1', summary: 'loadTexture options; fromData; fromImageBitmap; fromPass; cube maps.' },
	{ id: 'api/assets', title: 'Assets', since: '0.2', summary: 'loadGltf, loadTexture, loadEnvironment, preload, onProgress, destroy.' },
	{ id: 'api/animation', title: 'Animation', since: '0.2', summary: 'The animator; play, crossFade, layers, events; morph weights.' },
	{ id: 'api/raycast', title: 'Raycasting and spatial queries', since: '0.2', summary: 'raycast, raycastAny, raycastAll, raycastBatch, overlap queries, pointer events on objects.' },
	{ id: 'api/input', title: 'Input', since: '0.1', summary: 'Pointer, keyboard, touch and gamepad; action maps.' },
	{ id: 'api/controls', title: 'Camera controls (@sokko3d/controls)', since: '0.1', summary: 'Orbit and map controls (0.1); fly and first-person controls (0.2).' },
	{ id: 'api/post', title: 'Post-processing API', since: '0.2', summary: 'post.set options; post.addEffect for custom WGSL effects.' },
	{ id: 'api/render', title: 'Render graph API', since: '0.2', summary: 'render.addPass declarations; enabling and disabling passes; dumpGraph.' },
	{ id: 'api/quality', title: 'Quality API', since: '0.1', summary: 'quality.preset, quality.set, frame budgets, quality events.' },
	{ id: 'api/debug', title: 'Debug drawing and stats', since: '0.1', summary: 'debug.line, box, axes, grid, frustum; debug.view; debug.stats.' },
	{ id: 'api/math', title: 'Math helpers', since: '0.1', summary: 'vec3, quat, mat4 on arrays; math.clamp, lerp, damp, degToRad.' },
	{ id: 'api/time', title: 'Time', since: '0.1', summary: 'dt, time.now, fixed steps.' },
	{ id: 'api/sprites', title: 'Sprites', since: '0.2', summary: 'createSprites; world and screen size modes; atlases.' },
	{ id: 'api/points', title: 'Points', since: '0.2', summary: 'createPoints; size attenuation; textures.' },
	{ id: 'api/lines', title: 'Lines', since: '0.2', summary: 'createLines; pixel and world widths; dashes; edges from meshes.' },
	{ id: 'api/ui', title: 'UI overlays and labels', since: '0.2', summary: 'ui.trackLabel in the game; engine.labels.bind on the page.' },
	{ id: 'api/page', title: 'Messages between game and page', since: '0.1', summary: 'page.post and page.onMessage in the game; engine.postToGame and engine.onGameMessage on the page.' },

	{ id: 'guides/performance', title: 'Performance guide', since: '0.1', summary: 'Measuring; the frame budget; common causes of slow frames and their fixes.' },
	{ id: 'guides/phones', title: 'Phones and tablets', since: '0.1', summary: 'Pixel-ratio caps; memory budgets; heat; testing on real devices.' },
	{ id: 'guides/custom-shaders', title: 'Custom shaders', since: '0.1', summary: 'Surface functions; full shaders; uniforms and typed materials; hot reload.' },
	{ id: 'guides/custom-passes', title: 'Custom passes and render targets', since: '0.2', summary: 'Declaring passes; reading and writing named textures; layer masks.' },
	{ id: 'guides/loading-screens', title: 'Loading screens and warm-up', since: '0.1', summary: 'preload; onProgress; scene.warmUp; upload budgets.' },
	{ id: 'guides/ui-overlays', title: 'UI, HTML overlays and labels', since: '0.2', summary: 'HTML UI on the page; labels that follow objects; GUI panels.' },
	{ id: 'guides/video-textures', title: 'Video textures', since: 'after 1.0', summary: 'Planned after 1.0. Until then, the page sends ImageBitmap frames to the game; browser limits.' },
	{ id: 'guides/audio', title: 'Audio with Web Audio', since: '0.1', summary: 'Why audio stays on the page; sending positions from the game.' },
	{ id: 'guides/physics', title: 'Using a physics library', since: '0.1', summary: 'Running Rapier or cannon-es in the game worker; copying transforms.' },
	{ id: 'guides/multiple-views', title: 'Multiple views', since: 'after 1.0', summary: 'Split screens with scene.createView, after 1.0; minimaps work from 0.2 through render-to-texture passes.' },
	{ id: 'guides/assets-pipeline', title: 'The asset pipeline (sokko3d assets)', since: '0.2', summary: 'optimize, env, convert; LODs; texture compression; budget reports.' },
	{ id: 'guides/testing', title: 'Testing your game', since: '0.1', summary: 'sokko3d test; hold mode; image tests; reading results.' },
	{ id: 'guides/debugging', title: 'Debugging', since: '0.1', summary: 'Error codes; the inspector; the MCP server; the render-graph dump; common failures.' },
	{ id: 'guides/deploying', title: 'Deploying', since: '0.3', summary: 'Headers on common hosts; asset caching; size budgets.' },
	{ id: 'guides/agents', title: 'Working with AI agents', since: '0.3', summary: 'The skills; sokko3d docs; the MCP server; AGENTS.md in templates.' },

	{ id: 'shaders/wgsl-rules', title: 'WGSL rules for portable shaders', since: '0.1', summary: 'The three shared language features; limits budget; flat interpolation; what the build rejects.' },
	{ id: 'shaders/surface-functions', title: 'Surface functions', since: '0.1', summary: 'The surface record; vertex-offset functions; per-instance attributes.' },
	{ id: 'shaders/builtins', title: 'Built-in shader inputs', since: '0.1', summary: 'Camera, time, object, instance and light values available to custom shaders.' },
	{ id: 'shaders/library', title: 'Shader library and imports', since: '0.1', summary: 'Importing engine shader modules (math, noise, lighting helpers).' },

	{ id: 'porting/threejs-overview', title: 'Porting from three.js', since: '0.3', summary: 'The porting workflow; what gets faster; what needs rewriting.' },
	{ id: 'porting/threejs-materials', title: 'Porting materials and textures', since: '0.3', summary: 'Parameter-by-parameter conversion; color spaces; approximations.' },
	{ id: 'porting/threejs-shaders', title: 'Porting shaders: GLSL, onBeforeCompile and TSL', since: '0.3', summary: 'GLSL to WGSL; three.js built-ins to engine built-ins; worked examples.' },
	{ id: 'porting/threejs-postprocessing', title: 'Porting post-processing', since: '0.3', summary: 'EffectComposer passes to post.set and post.addEffect.' },
	{ id: 'porting/threejs-loop-and-threads', title: 'The render loop, threads and the DOM', since: '0.3', summary: 'What moves to the game worker; what stays on the page; messages.' },
	{ id: 'porting/react-three-fiber', title: 'Porting React Three Fiber', since: '0.3', summary: 'Canvas, useFrame, drei helpers; keeping React for the page UI.' },
	{ id: 'porting/threejs-unsupported', title: 'Unsupported three.js features', since: '0.3', summary: 'Features after 1.0 or out of scope, with workarounds.' },
	{ id: 'porting/verification', title: 'Verifying a port', since: '0.3', summary: 'Parity images per camera view; performance comparison; the WebGL2 path; phones.' },

	{ id: 'cli/sokko3d', title: 'The sokko3d command', since: '0.3', summary: 'create, dev, build, test, bench, shot, assets, docs, port, skills, doctor.' },
	{ id: 'errors/index', title: 'Error codes', since: '0.1', summary: 'Every EngineError code with its cause and fix.' },
	{ id: 'cookbook/index', title: 'Cookbook', since: '0.2', summary: 'Short recipes; each is also a tested example.' },
];

/** Marks a page as generated from the inventory, so the generator may rewrite it. */
export const PLACEHOLDER_MARKER = '<!-- sokko3d:placeholder -->';
const PAGE_LIST_START = '<!-- sokko3d:page-list:start -->';
const PAGE_LIST_END = '<!-- sokko3d:page-list:end -->';

export const MAPPING_SOURCE = 'docs/data/threejs-mapping.json';
const MAPPING_PAGE = 'docs/porting/threejs-mapping.md';
const SKILL_MAPPING_DIR = 'skills/sokko3d-port-threejs/references';

/** Docs areas: the first path segment of every page ID. */
export const DOC_AREAS = new Set(AREAS.map(([id]) => id));

export function pagePath(id: string): string {
	return `docs/${id}.md`;
}

export function placeholderPage(page: PageEntry): string {
	const when = page.since.startsWith('after ')
		? `after sokko3d ${page.since.slice('after '.length)}`
		: `sokko3d ${page.since}`;
	return `${renderFrontMatter([
		['id', page.id],
		['title', page.title],
		['status', 'planned'],
		['since', page.since],
		['summary', page.summary],
	])}
${PLACEHOLDER_MARKER}

# ${page.title}

> Planned for ${when}. This page is a placeholder: the feature is designed but not built yet, so the APIs it names do not exist. Coding agents must not use them.

This page will cover: ${page.summary}
`;
}

interface MappingEntry {
	category: string;
	three: string;
	target: string;
	status: string;
	since?: string;
	notes?: string;
	docs: string;
}

interface Mapping {
	statusLegend: Record<string, string>;
	sinceLegend: Record<string, string>;
	entries: MappingEntry[];
}

const cell = (s: string | undefined) => String(s ?? '').replace(/\|/g, '\\|');

export function mappingMarkdown(mapping: Mapping, forSkill: boolean): string {
	const lines: string[] = [];
	if (forSkill) {
		lines.push('# three.js to sokko3d mapping\n');
	} else {
		lines.push(
			renderFrontMatter([
				['id', 'porting/threejs-mapping'],
				['title', 'three.js to sokko3d mapping'],
				['status', 'generated'],
				['since', '0.3'],
				['summary', 'Every three.js API a port is likely to meet, with its sokko3d equivalent.'],
			]),
		);
		lines.push('# three.js to sokko3d mapping\n');
	}
	lines.push(
		`This page is generated from \`${MAPPING_SOURCE}\` by \`tools/gen-docs.ts\`. To change it, edit the JSON file.\n`,
	);
	lines.push('Status values:\n');
	for (const [key, text] of Object.entries(mapping.statusLegend))
		lines.push(`- \`${key}\`: ${text}`);
	lines.push('\nThe "Since" column gives the first engine version with the feature:\n');
	for (const [version, milestone] of Object.entries(mapping.sinceLegend))
		lines.push(`- ${version}: ${milestone}`);
	lines.push('');
	const categories = [...new Set(mapping.entries.map((e) => e.category))];
	if (forSkill) {
		lines.push('## Contents\n');
		for (const c of categories) lines.push(`- ${c}`);
		lines.push('');
	}
	for (const c of categories) {
		lines.push(`## ${c}\n`);
		lines.push('| three.js | sokko3d | Status | Since | Notes | Docs |');
		lines.push('| --- | --- | --- | --- | --- | --- |');
		for (const e of mapping.entries.filter((x) => x.category === c)) {
			lines.push(
				`| ${cell(e.three)} | ${cell(e.target)} | ${e.status} | ${e.since ?? '-'} | ${cell(e.notes)} | \`${e.docs}\` |`,
			);
		}
		lines.push('');
	}
	return lines.join('\n');
}

export interface PageInfo {
	id: string;
	title: string;
	status: string;
	since: string;
	summary: string;
}

/** Front matter of every docs page, preferring content about to be generated over the file on disk. */
function collectPages(root: string, generated: Map<string, string>): PageInfo[] {
	const paths = new Set([
		...docsFiles(root),
		...[...generated.keys()].filter((p) => p.startsWith('docs/') && p.endsWith('.md')),
	]);
	const out: PageInfo[] = [];
	for (const path of paths) {
		const text = generated.get(path) ?? readIfExists(root, path);
		if (text === null) continue;
		const data = parseFrontMatter(text)?.data;
		if (!data) continue;
		out.push({
			id: String(data.id ?? ''),
			title: String(data.title ?? ''),
			status: String(data.status ?? ''),
			since: String(data.since ?? ''),
			summary: String(data.summary ?? ''),
		});
	}
	return out;
}

/** The generated page list for docs/index.md: every page by area, in inventory order. */
export function pageList(pages: PageInfo[]): string {
	const order = new Map(PAGES.map((p, i) => [p.id, i]));
	const rank = (p: PageInfo) => order.get(p.id) ?? Number.MAX_SAFE_INTEGER;
	const sections: string[] = [];
	for (const [area, heading] of AREAS) {
		const inArea = pages
			.filter((p) => p.id.split('/')[0] === area)
			.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
		if (inArea.length === 0) continue;
		const rows = inArea.map(
			(p) => `| [${cell(p.title)}](${p.id}.md) | ${cell(p.summary)} | ${p.status} | ${p.since} |`,
		);
		sections.push(
			[
				`### ${heading}`,
				'',
				'| Page | What it covers | Status | Version |',
				'| --- | --- | --- | --- |',
				...rows,
			].join('\n'),
		);
	}
	return sections.join('\n\n');
}

function replaceBetween(
	text: string,
	start: string,
	end: string,
	inner: string,
	path: string,
): string {
	const from = text.indexOf(start);
	const to = text.indexOf(end);
	if (from === -1 || to === -1 || to < from) {
		throw new Error(`${path} must contain ${start} and ${end} around the generated page list`);
	}
	return `${text.slice(0, from + start.length)}\n\n${inner}\n\n${text.slice(to)}`;
}

/** Every generated file with its expected content, keyed by repository-relative path. */
export function generateDocs(root: string): Map<string, string> {
	const out = new Map<string, string>();

	for (const page of PAGES) {
		if (page.id === 'index') continue;
		const path = pagePath(page.id);
		const current = readIfExists(root, path);
		if (current === null || current.includes(PLACEHOLDER_MARKER))
			out.set(path, placeholderPage(page));
	}

	const mappingText = readIfExists(root, MAPPING_SOURCE);
	if (mappingText === null) throw new Error(`${MAPPING_SOURCE} is missing`);
	const mapping = JSON.parse(mappingText) as Mapping;
	out.set(MAPPING_PAGE, mappingMarkdown(mapping, false));
	out.set(`${SKILL_MAPPING_DIR}/api-mapping.md`, mappingMarkdown(mapping, true));
	out.set(`${SKILL_MAPPING_DIR}/threejs-mapping.json`, `${JSON.stringify(mapping, null, 2)}\n`);

	const indexPath = pagePath('index');
	const index = readIfExists(root, indexPath);
	if (index === null) throw new Error(`${indexPath} is missing; it is written by hand`);
	const listed = collectPages(root, out).filter((p) => p.id !== 'index');
	out.set(
		indexPath,
		replaceBetween(index, PAGE_LIST_START, PAGE_LIST_END, pageList(listed), indexPath),
	);

	return out;
}

/** Writes every generated file whose content changed. Returns the paths written. */
export function writeGeneratedDocs(root: string): string[] {
	const written: string[] = [];
	for (const [path, content] of generateDocs(root)) {
		if (readIfExists(root, path) === content) continue;
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
		written.push(path);
	}
	return written;
}

/** Paths in `expected` whose file content on disk differs from the expected content. */
export function staleFiles(root: string, expected: Map<string, string>): string[] {
	return [...expected]
		.filter(([path, content]) => readIfExists(root, path) !== content)
		.map(([path]) => path);
}

/** Generated files whose committed content differs from what the generator makes now. */
export function staleGeneratedDocs(root: string): string[] {
	return staleFiles(root, generateDocs(root));
}

/** Problems with one page's front matter, for the page at `path`. */
export function frontMatterProblems(path: string, text: string, inventory: Set<string>): string[] {
	let data: Record<string, unknown> | undefined;
	try {
		data = parseFrontMatter(text)?.data;
	} catch (e) {
		return [`${path}: front matter is not valid YAML (${(e as Error).message})`];
	}
	if (!data) return [`${path}: no front matter`];
	const problems: string[] = [];
	const id = path.slice('docs/'.length, -'.md'.length);
	if (data.id !== id)
		problems.push(`${path}: front matter id is "${String(data.id)}"; it must be "${id}"`);
	for (const key of ['title', 'summary'] as const) {
		if (typeof data[key] !== 'string' || (data[key] as string).trim() === '')
			problems.push(`${path}: front matter ${key} is missing`);
	}
	if (!STATUSES.includes(data.status as (typeof STATUSES)[number])) {
		problems.push(`${path}: status "${String(data.status)}" must be one of ${STATUSES.join(', ')}`);
	}
	if (typeof data.since !== 'string' || !SINCE_FORMAT.test(data.since)) {
		problems.push(
			`${path}: since "${String(data.since)}" must be a quoted version such as "0.1", or "after 1.0"`,
		);
	}
	if (data.status !== 'generated' && !inventory.has(id)) {
		problems.push(`${path}: page is not in the inventory in tools/lib/docs.ts`);
	}
	return problems;
}

/** Every problem with the docs: stale generated files, missing pages, bad front matter, broken links. */
export function checkDocs(root: string): string[] {
	const problems: string[] = [];
	try {
		for (const path of staleGeneratedDocs(root))
			problems.push(`${path} is out of date: run bun run docs`);
	} catch (e) {
		problems.push((e as Error).message);
	}
	const inventory = new Set(PAGES.map((p) => p.id));
	for (const page of PAGES) {
		if (!existsSync(join(root, pagePath(page.id))))
			problems.push(`${pagePath(page.id)} is missing: run bun run docs`);
	}
	for (const path of docsFiles(root)) {
		problems.push(...frontMatterProblems(path, readIfExists(root, path) ?? '', inventory));
	}
	problems.push(...checkLinkTree(linkedFiles(root), (p) => existsSync(join(root, p))));
	return problems;
}
