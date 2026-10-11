// The documentation inventory and every file generated from a single source: placeholder pages for
// planned pages, the API reference on the api/ pages, the page list in docs/index.md, the error
// pages, the tables of the quality presets page, the shader library's page, the three.js mapping
// page with the porting skill's copies of the mapping, and the tables of the record of tested
// devices. Git keeps none of this output (tools/lib/generated.ts). Generation is computed in memory
// first, so the check reads the same content that the generator writes.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ERRORS, type ErrorEntry } from '../../packages/engine/src/errors/codes.ts';
import {
	CHECK_GRACE_MS,
	CHECK_HOLD_SHARE,
	CHECK_MAX_FPS,
	CHECK_UPLOAD_WAIT_MS,
	CHECK_WINDOW_MS,
} from '../../packages/engine/src/quality/check.ts';
import {
	DEVICE_PRESETS,
	type DeviceKind,
	LOW_MEMORY_GB,
	TIER_CEILINGS,
} from '../../packages/engine/src/quality/chooser.ts';
import {
	CHANGE_DOCS,
	DEVICE_DOCS,
	settingRows,
	TIER_DOCS,
} from '../../packages/engine/src/quality/preset-docs.ts';
import { QUALITY_PRESETS } from '../../packages/engine/src/quality/presets.ts';
import type { Tier } from '../../packages/engine/src/shared/tier.ts';
import { type ApiReference, readApi, renderReference, tableCell } from './api-docs';
import { docsFiles, readIfExists } from './files';
import { parseFrontMatter, renderFrontMatter } from './frontmatter';
import { checkLinkTree, linkedFiles } from './links';
import { LIBRARY_PAGE_ID, libraryPage, readLibrary } from './shader-library';
import { releaseOf, STEPS_NOTE, shipsSentence } from './steps';
import { RECORD_TABLES_PAGE, readRecord, recordFiles, recordTablesPage } from './tested-devices';

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

/** A roadmap step named as a release, such as "null3D 0.2", which no release is called. */
const STEP_AS_RELEASE = /\bnull3D (0\.[23])(?!\.?\d)/;

/** Every page the docs will have. A page that does not exist yet is generated as a placeholder. */
// biome-ignore format: one page per line keeps the inventory readable as a table
export const PAGES: readonly PageEntry[] = [
	{ id: 'index', title: 'null3D documentation', since: '0.1', summary: 'What null3D is; how the docs are organized; status labels.' },
	{ id: 'getting-started/install', title: 'Install null3D', since: '0.1', summary: 'The npm packages; the Vite plugin; package versions always match; the optional `null3d` command.' },
	{ id: 'getting-started/first-scene', title: 'Your first scene', since: '0.1', summary: 'page.ts with createEngine; sketch.ts with defineSketch; camera, light, mesh; running it with Vite.' },
	{ id: 'getting-started/hosting', title: 'Hosting and cross-origin isolation', since: '0.1', summary: 'COOP and COEP headers; require-corp on Safari; CORS and CORP for assets; the single-threaded fallback.' },
	{ id: 'getting-started/project-structure', title: 'Project structure', since: '0.3', summary: 'Starting from a template with `bunx @null3d/cli create`; page.ts, sketch.ts, assets/, AGENTS.md, .claude/skills/; what runs where.' },

	{ id: 'concepts/architecture', title: 'Architecture: threads and the frame', since: '0.1', summary: 'Main thread, sketch worker, render worker, job workers; the pipelined frame; latency modes.' },
	{ id: 'concepts/handles', title: 'Handles and objects', since: '0.1', summary: '30-bit handles; wrapper objects; stale-handle errors; keeping per-object data in your own arrays.' },
	{ id: 'concepts/static-dynamic', title: 'Static and dynamic objects', since: '0.1', summary: 'When to mark objects static; setters versus direct array writes; dirty ranges.' },
	{ id: 'concepts/instances', title: 'Instances and batching', since: '0.1', summary: 'createInstances; typed-array views; markDirty; automatic batching; per-instance attributes.' },
	{ id: 'concepts/backends', title: 'GPU tiers and backends', since: '0.1', summary: 'WebGPU core, compatibility mode and WebGL2; capability flags; the portable budget; never branching on GPU names.' },
	{ id: 'concepts/quality-presets', title: 'Quality presets, dynamic resolution and frame budgets', since: '0.1', summary: 'Low to Ultra; pixel-ratio caps; the preset check; switching presets; the frame-budget governor; quality events for sketch code.' },
	{ id: 'concepts/color-management', title: 'Color management', since: '0.1', summary: 'Linear working space; sRGB hex colors and linear arrays; HDR color; exposure and tone mapping; transparent canvases; parity with three.js.' },
	{ id: 'concepts/materials', title: 'Materials and pipelines', since: '0.1', summary: 'Built-in materials; permutations; pipeline warm-up; why changing shader features can stall a frame.' },
	{ id: 'concepts/lighting', title: 'Lighting and environment', since: '0.1', summary: 'Light types and units; clustered lighting; fog; environment maps and spherical harmonics.' },
	{ id: 'concepts/shadows', title: 'Shadows', since: '0.1', summary: 'Cascades; update rates; filtering per preset; bias settings.' },
	{ id: 'concepts/render-layers', title: 'Render layers', since: '0.1', summary: '32-bit layer masks on objects, cameras, raycasts and passes.' },
	{ id: 'concepts/render-graph', title: 'The render graph', since: '0.1', summary: 'Declared reads and writes; automatic order; transient memory; validation errors; the text dump.' },
	{ id: 'concepts/large-worlds', title: 'Large worlds and precision', since: '0.2', summary: 'Cell-relative positions and per-frame camera-to-cell offsets; reversed depth; largeWorld mode; batch origins; floating-origin geometry.' },
	{ id: 'concepts/culling', title: 'Culling', since: '0.1', summary: 'Frustum culling on the GPU on WebGPU and on the job workers on WebGL2; grid cells and positions relative to the camera.' },
	{ id: 'concepts/lod', title: 'Levels of detail', since: '0.2', summary: 'LOD groups; generated LODs; per-instance selection.' },
	{ id: 'concepts/assets', title: 'Assets and prefabs', since: '0.2', summary: 'glTF, KTX2, meshopt; prefabs and instantiate; upload budgets; memory.' },
	{ id: 'concepts/post-processing', title: 'The post-processing chain', since: '0.2', summary: 'HDR target; custom effects; bloom; ambient occlusion; the single final pass; custom tone curves.' },

	{ id: 'api/engine', title: 'Page API: createEngine', since: '0.1', summary: 'createEngine options; engine.postToSketch, capture, labels, requestPointerLock, capabilities, destroy.' },
	{ id: 'api/sketch', title: 'Sketch API: defineSketch and the context', since: '0.1', summary: 'The context object: scene, assets, materials, geometry, textures, input, time, engine, quality, post, render, page, ui, debug; the callbacks.' },
	{ id: 'api/scene', title: 'Scene', since: '0.1', summary: 'Creating objects; find; background, environment, fog, sky; warmUp.' },
	{ id: 'api/objects', title: 'Objects and transforms', since: '0.1', summary: 'Setters and getters; parents; flags; destroy.' },
	{ id: 'api/cameras', title: 'Cameras', since: '0.1', summary: 'Perspective and orthographic cameras; screenToRay; worldToScreen; layers.' },
	{ id: 'api/lights', title: 'Lights', since: '0.1', summary: 'Directional, point, spot, hemisphere and ambient lights; shadow options.' },
	{ id: 'api/geometry', title: 'Geometry', since: '0.1', summary: 'Generators with three.js parameters; meshes from arrays; vertex formats; large meshes.' },
	{ id: 'api/materials', title: 'Materials', since: '0.1', summary: 'standard, unlit, shader, shadowCatcher; every option.' },
	{ id: 'api/textures', title: 'Textures', since: '0.1', summary: 'loadTexture options; fromData; fromImageBitmap; fromPass; cube maps.' },
	{ id: 'api/assets', title: 'Assets', since: '0.1', summary: 'loadTexture, loadImageBitmap, loadJson, loadBinary, preload, onProgress; glTF models and environments.' },
	{ id: 'api/animation', title: 'Animation', since: '0.2', summary: 'The animator; play, crossFade, layers, events; morph weights.' },
	{ id: 'api/raycast', title: 'Raycasting and spatial queries', since: '0.2', summary: 'raycast, raycastAny, raycastAll, raycastBatch, overlap queries, pointer events on objects.' },
	{ id: 'api/input', title: 'Input', since: '0.1', summary: 'Pointer, keyboard, touch and gamepad; action maps.' },
	{ id: 'api/controls', title: 'Camera controls (@null3d/controls)', since: '0.1', summary: 'Orbit and map controls (0.1); fly and first-person controls, with pointer lock (0.2).' },
	{ id: 'api/post', title: 'Post-processing API', since: '0.1', summary: 'post.set for tone mapping and exposure; the effects of 0.2; custom effects with post.addEffect and custom tone curves.' },
	{ id: 'api/render', title: 'Render graph API', since: '0.2', summary: 'render.addPass for scene passes that draw into textures; switching and removing passes; render.dumpGraph.' },
	{ id: 'api/quality', title: 'Quality API', since: '0.1', summary: 'quality.preset, quality.set, quality.setPreset, the preset check, frame budgets, quality events.' },
	{ id: 'api/debug', title: 'Debug drawing and stats', since: '0.1', summary: 'debug.line, box, sphere, arrow, axes, grid, frustum and light; engine.measure and its figures; debug.view; debug.stats.' },
	{ id: 'api/math', title: 'Math helpers', since: '0.1', summary: 'vec3, quat, mat4 and color on plain arrays; math.clamp, lerp, damp and a random generator that hold mode seeds.' },
	{ id: 'api/time', title: 'Time', since: '0.1', summary: 'dt, time.now, fixed steps.' },
	{ id: 'api/sprites', title: 'Sprites', since: '0.2', summary: 'createSprites; world and screen size modes; atlases.' },
	{ id: 'api/points', title: 'Points', since: '0.2', summary: 'createPoints; size attenuation; textures.' },
	{ id: 'api/lines', title: 'Lines', since: '0.2', summary: 'createLines; pixel and world widths; dashes; edges from meshes.' },
	{ id: 'api/ui', title: 'UI overlays and labels', since: '0.2', summary: 'ui.trackLabel in the sketch; engine.labels.bind on the page.' },
	{ id: 'api/page', title: 'Messages between sketch and page', since: '0.1', summary: 'page.post and page.onMessage in the sketch; engine.postToSketch and engine.onSketchMessage on the page.' },

	{ id: 'guides/performance', title: 'Performance guide', since: '0.1', summary: 'Measuring; the frame budget; common causes of slow frames and their fixes.' },
	{ id: 'guides/phones', title: 'Phones and tablets', since: '0.1', summary: 'Pixel-ratio caps; memory budgets; heat; testing on real devices.' },
	{ id: 'guides/custom-shaders', title: 'Custom shaders', since: '0.1', summary: 'WGSL in sketch code; shader errors; surface functions; full shaders; uniforms and typed materials; hot reload.' },
	{ id: 'guides/custom-passes', title: 'Custom passes and render targets', since: '0.2', summary: 'Custom effects and tone curves in WGSL; declaring passes; reading and writing named textures; layer masks.' },
	{ id: 'guides/loading-screens', title: 'Loading screens and warm-up', since: '0.1', summary: 'preload; onProgress; scene.warmUp; the preset check; upload budgets; switching presets behind a loading screen.' },
	{ id: 'guides/accessibility', title: 'Accessibility', since: '0.1', summary: 'What the canvas tells assistive technology; keyboard use; reduced motion; pausing; loading and errors.' },
	{ id: 'guides/content-pages', title: '3D scenes on content pages', since: '0.1', summary: 'Product and marketing pages: the fallback page, a load deadline, pausing off screen, scroll-driven cameras, second visits and crashes.' },
	{ id: 'guides/ui-overlays', title: 'UI, HTML overlays and labels', since: '0.2', summary: 'HTML UI on the page; labels that follow objects; GUI panels.' },
	{ id: 'guides/video-textures', title: 'Video textures', since: 'after 1.0', summary: 'Planned after 1.0. Until then, the page sends ImageBitmap frames to the sketch; browser limits.' },
	{ id: 'guides/audio', title: 'Audio with Web Audio', since: '0.1', summary: 'Why audio stays on the page; sending positions from the sketch.' },
	{ id: 'guides/physics', title: 'Using a physics library', since: '0.1', summary: 'Running Rapier or cannon-es in the sketch worker; copying transforms.' },
	{ id: 'guides/multiple-views', title: 'Multiple views', since: 'after 1.0', summary: 'Split screens with scene.createView, after 1.0; minimaps work from 0.2 through render-to-texture passes.' },
	{ id: 'guides/assets-pipeline', title: 'The asset pipeline (the `assets` command)', since: '0.2', summary: 'optimize, env, convert; LODs; texture compression; budget reports.' },
	{ id: 'guides/testing', title: 'Testing your sketch', since: '0.1', summary: 'Hold mode; image tests; reading results; frames that stay the same on every run.' },
	{ id: 'guides/debugging', title: 'Debugging', since: '0.1', summary: 'Error codes; the inspector; the MCP server; the render-graph dump; common failures.' },
	{ id: 'guides/deploying', title: 'Deploying', since: '0.3', summary: 'Headers on common hosts; asset caching; size budgets.' },
	{ id: 'guides/agents', title: 'Working with AI agents', since: '0.1', summary: 'Installing the null3D skills in Claude Code, claude.ai and other agent tools; docs by ID; the test loop; the MCP server and AGENTS.md in templates (0.3).' },

	{ id: 'shaders/wgsl-rules', title: 'WGSL rules for portable shaders', since: '0.1', summary: 'The three shared language features; optional features; flat interpolation; limits budget; rules the build cannot check.' },
	{ id: 'shaders/surface-functions', title: 'Surface functions', since: '0.1', summary: 'The surface record; vertex-offset functions; per-instance attributes.' },
	{ id: 'shaders/builtins', title: 'Built-in shader inputs', since: '0.1', summary: 'Camera, time, object, instance and light values available to custom shaders.' },
	{ id: 'shaders/library', title: 'Shader library and imports', since: '0.1', summary: 'The WGSL modules that ship with the engine: math, noise, color, lighting, fog, vertex, depth and signed distance helpers, and how to import them.' },

	{ id: 'porting/threejs-overview', title: 'Porting from three.js', since: '0.3', summary: 'The porting workflow; what gets faster; what needs rewriting.' },
	{ id: 'porting/threejs-materials', title: 'Porting materials and textures', since: '0.3', summary: 'Parameter-by-parameter conversion; color spaces; approximations.' },
	{ id: 'porting/threejs-shaders', title: 'Porting shaders: GLSL, onBeforeCompile and TSL', since: '0.3', summary: 'GLSL to WGSL; three.js built-ins to engine built-ins; worked examples.' },
	{ id: 'porting/threejs-postprocessing', title: 'Porting post-processing', since: '0.2', summary: 'EffectComposer passes and pmndrs effects to post.set settings; ShaderPass to post.addEffect; three.js tone mappings to custom tone curves.' },
	{ id: 'porting/threejs-loop-and-threads', title: 'The render loop, threads and the DOM', since: '0.3', summary: 'What moves to the sketch worker; what stays on the page; messages.' },
	{ id: 'porting/react-three-fiber', title: 'Porting React Three Fiber', since: '0.3', summary: 'Canvas, useFrame, drei helpers; keeping React for the page UI.' },
	{ id: 'porting/threejs-unsupported', title: 'Unsupported three.js features', since: '0.3', summary: 'Features after 1.0 or out of scope, with workarounds.' },
	{ id: 'porting/verification', title: 'Verifying a port', since: '0.3', summary: 'Parity images per camera view; performance comparison; the WebGL2 path; phones.' },

	{ id: 'cli/null3d', title: 'The `null3d` command', since: '0.1', summary: 'create, test, bench, shot, assets, docs, port, skills, mcp, doctor.' },
	{ id: 'cookbook/index', title: 'Cookbook', since: '0.2', summary: 'Short recipes; each is also a tested example.' },
];

/** Marks a page as generated from the inventory, so the generator may rewrite it. */
export const PLACEHOLDER_MARKER = '<!-- null3d:placeholder -->';
/** The generated page that lists every docs page. */
export const PAGE_LIST_ID = 'pages';
/** The folder of the generated reference pages of written API pages. */
const REFERENCE_AREA = 'api/reference';
/** The generated page of the quality presets' tables. */
export const PRESET_TABLES_ID = 'concepts/quality-preset-tables';

/** A preset's name as a table prints it: "Low". */
const presetTitle = (preset: string) => preset.charAt(0).toUpperCase() + preset.slice(1);

/** A Markdown table from its header and its rows of cells. */
function markdownTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
	const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
	return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

/** The preset that each kind of device starts at, from the chooser's constants. */
export function presetDeviceTable(): string {
	const rows = (Object.keys(DEVICE_PRESETS) as DeviceKind[]).map((kind) => {
		const { name, pointer, screen } = DEVICE_DOCS[kind];
		return [name, pointer, screen, presetTitle(DEVICE_PRESETS[kind])];
	});
	return `${markdownTable(['Device', 'Main pointer', 'Smaller screen edge', 'Starting preset'], rows)}

A memory reading under ${LOW_MEMORY_GB} GB lowers the starting preset by one.`;
}

/** The highest preset of each GPU path, from the chooser's constants. */
export function presetCeilingTable(): string {
	const rows = (Object.keys(TIER_CEILINGS) as Tier[]).map((tier) => [
		TIER_DOCS[tier],
		presetTitle(TIER_CEILINGS[tier]),
	]);
	return markdownTable(['GPU path', 'Highest preset'], rows);
}

/** Every quality setting with its value on each preset, from the preset table. */
export function presetSettingsTable(): string {
	const rows = settingRows().map((row) => [
		`${row.label} (\`${row.name}\`)`,
		...row.values.map(tableCell),
		CHANGE_DOCS[row.changes],
		row.built ? 'built' : 'planned',
	]);
	return markdownTable(['Setting', ...QUALITY_PRESETS.map(presetTitle), 'Changes', 'Status'], rows);
}

/** The preset check's rules, from its constants. */
export function presetCheckTable(): string {
	const rows = [
		[
			'Target frame rate',
			`The display's refresh rate, at most ${CHECK_MAX_FPS} frames per second unless \`targetFps\` asks for more`,
		],
		['A preset holds its target', `At ${CHECK_HOLD_SHARE * 100}% of the target or more`],
		[
			'Frames drawn before each measurement',
			`${CHECK_GRACE_MS} ms, and up to ${CHECK_UPLOAD_WAIT_MS} ms more while textures upload`,
		],
		['Measurement of each preset', `${CHECK_WINDOW_MS} ms`],
	];
	return markdownTable(['Rule', 'Value'], rows);
}

/** The page of the quality presets' tables, from the chooser's constants and the preset table. */
export function presetTablesPage(): string {
	return `${renderFrontMatter([
		['id', PRESET_TABLES_ID],
		['title', 'Quality preset tables'],
		['status', 'generated'],
		['since', '0.1'],
		['summary', "Each preset's starting devices, GPU path caps, check rules and settings."],
	])}
# Quality preset tables

> [Quality presets](quality-presets.md) explains these tables. The engine's own constants make them.

## Starting preset of each device

${presetDeviceTable()}

## Highest preset of each GPU path

${presetCeilingTable()}

## Rules of the preset check

${presetCheckTable()}

## Settings of each preset

${presetSettingsTable()}
`;
}

/**
 * The single source of the three.js mapping. The mapping page and the porting skill's copies come
 * from it, so edit it and never the copies.
 */
export const MAPPING_SOURCE = 'docs/data/threejs-mapping.json';
const MAPPING_PAGE = 'docs/porting/threejs-mapping.md';
const SKILL_MAPPING_DIR = 'skills/null3d-port-threejs/references';

/** Docs areas: the first path segment of every page ID. */
export const DOC_AREAS = new Set(AREAS.map(([id]) => id));

export function pagePath(id: string): string {
	return `docs/${id}.md`;
}

/** The ID of a written API page's generated reference page, such as api/reference/scene. */
export function referencePageId(id: string): string {
	return `${REFERENCE_AREA}/${id.slice('api/'.length)}`;
}

/** The link from a written API page to its reference page. */
export function referenceLink(id: string): string {
	return `(reference/${id.slice('api/'.length)}.md)`;
}

/** The generated reference page of a written API page: its exports, from their doc comments. */
export function referencePage(page: PageEntry, reference: string): string {
	return `${renderFrontMatter([
		['id', referencePageId(page.id)],
		['title', `${page.title}: API reference`],
		['status', 'generated'],
		['since', page.since],
		['summary', `Every export of the ${page.title} API, from the engine's doc comments.`],
	])}
# ${page.title}: API reference

> [${page.title}](../${page.id.slice('api/'.length)}.md) explains these exports. The engine's doc comments make this page.

${reference}
`;
}

/**
 * A planned page. With a reference, the page lists the exports the engine has so far under an
 * "API reference" heading.
 */
export function placeholderPage(page: PageEntry, reference = ''): string {
	const when = releaseOf(page.since);
	const note = reference
		? `Planned for ${when}. No release has these APIs yet, so coding agents must not use them. The reference below lists the APIs the engine has now. The rest of the page is not written yet.`
		: `Planned for ${when}. This page is a placeholder. No release has this feature yet, so the APIs it names do not exist. Coding agents must not use them.`;
	return `${renderFrontMatter([
		['id', page.id],
		['title', page.title],
		['status', 'planned'],
		['since', page.since],
		['summary', page.summary],
	])}
${PLACEHOLDER_MARKER}

# ${page.title}

> ${note}

This page will cover: ${page.summary}
${reference ? `\n## API reference\n\n${reference}\n` : ''}`;
}

/** Problems with the shader library's modules that keep its page from being right. */
export function libraryProblems(root: string): string[] {
	return readLibrary(root).problems.map((problem) => `Shader library: ${problem}`);
}

/** Problems that keep an export out of the reference, including a page tag that names no page. */
export function referenceProblems(api: ApiReference): string[] {
	const pages = new Set(PAGES.map((p) => p.id));
	return [
		...api.problems,
		...api.symbols
			.filter((s) => s.page.startsWith('api/') && !pages.has(s.page))
			.map((s) => `${s.name} names the page ${s.page}, which is not in the inventory`),
	].map((problem) => `API reference: ${problem}`);
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

export function mappingMarkdown(mapping: Mapping, forSkill: boolean): string {
	const lines: string[] = [];
	if (forSkill) {
		lines.push('# three.js to null3D mapping\n');
	} else {
		lines.push(
			renderFrontMatter([
				['id', 'porting/threejs-mapping'],
				['title', 'three.js to null3D mapping'],
				['status', 'generated'],
				['since', '0.3'],
				['summary', 'Every three.js API a port is likely to meet, with its null3D equivalent.'],
			]),
		);
		lines.push('# three.js to null3D mapping\n');
	}
	lines.push('Status values:\n');
	for (const [key, text] of Object.entries(mapping.statusLegend))
		lines.push(`- \`${key}\`: ${text}`);
	lines.push(`\nThe "Since" column gives the roadmap step that adds the feature. ${STEPS_NOTE}\n`);
	for (const [version, label] of Object.entries(mapping.sinceLegend))
		lines.push(`- ${version}: ${label}`);
	lines.push('');
	const categories = [...new Set(mapping.entries.map((e) => e.category))];
	if (forSkill) {
		lines.push('## Contents\n');
		for (const c of categories) lines.push(`- ${c}`);
		lines.push('');
	}
	for (const c of categories) {
		lines.push(`## ${c}\n`);
		lines.push('| three.js | null3D | Status | Since | Notes | Docs |');
		lines.push('| --- | --- | --- | --- | --- | --- |');
		for (const e of mapping.entries.filter((x) => x.category === c)) {
			lines.push(
				`| ${tableCell(e.three)} | ${tableCell(e.target)} | ${e.status} | ${e.since ?? '-'} | ${tableCell(e.notes)} | \`${e.docs}\` |`,
			);
		}
		lines.push('');
	}
	return lines.join('\n');
}

/** The docs page of one error code, generated from the engine's error table. */
export function errorPage(code: string, entry: ErrorEntry): string {
	return `${renderFrontMatter([
		['id', `errors/${code}`],
		['title', `${code}: ${entry.title}`],
		['status', 'generated'],
		['since', entry.since],
		['summary', entry.cause],
	])}
# ${code}: ${entry.title}

## What happened

${entry.cause}

## How to fix it

${entry.fix}

## Example

\`\`\`text
${entry.example}
\`\`\`
`;
}

/** The list of every error code, generated from the engine's error table. */
export function errorIndexPage(errors: Record<string, ErrorEntry>): string {
	const rows = Object.entries(errors).map(
		([code, entry]) =>
			`| [${code}](${code}.md) | ${tableCell(entry.title)} | ${tableCell(entry.cause)} |`,
	);
	return `${renderFrontMatter([
		['id', 'errors/index'],
		['title', 'Error codes'],
		['status', 'generated'],
		['since', '0.1'],
		['summary', 'Every EngineError code with its cause and fix.'],
	])}
# Error codes

Every error the engine throws is an \`EngineError\` with a code. Its message names the call and the object, says what failed and how to fix it, and links to the code's page here.

| Code | Error | What happened |
| --- | --- | --- |
${rows.join('\n')}
`;
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
	paths.delete(pagePath('index'));
	paths.delete(pagePath(PAGE_LIST_ID));
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

/** The list of pages: every page by area, in inventory order. */
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
			(p) =>
				`| [${tableCell(p.title)}](${p.id}.md) | ${tableCell(p.summary)} | ${p.status} | ${p.since} |`,
		);
		sections.push(
			[
				`## ${heading}`,
				'',
				'| Page | What it covers | Status | Step |',
				'| --- | --- | --- | --- |',
				...rows,
			].join('\n'),
		);
	}
	return sections.join('\n\n');
}

/** The generated page that lists every docs page by area, apart from the reference pages. */
export function pageListPage(pages: PageInfo[]): string {
	const listed = pages.filter((p) => !p.id.startsWith(`${REFERENCE_AREA}/`));
	return `${renderFrontMatter([
		['id', PAGE_LIST_ID],
		['title', 'All pages'],
		['status', 'generated'],
		['since', '0.1'],
		['summary', 'Every docs page by area, with its status and version.'],
	])}
# All pages

> The docs generator writes this list from each page's front matter. [The docs home](index.md) explains the status labels. The step column gives the roadmap step that adds each page's feature. ${STEPS_NOTE}

${pageList(listed)}
`;
}

/**
 * Every generated file with its content, keyed by repository-relative path. Git keeps none of
 * them, and written pages link to the generated ones. `api` is the engine's reference, which tests
 * replace.
 */
export function generateDocs(root: string, api: ApiReference = readApi(root)): Map<string, string> {
	const out = new Map<string, string>();

	const byPage = Map.groupBy(api.symbols, (s) => s.page);
	for (const page of PAGES) {
		if (page.id === 'index' || page.id === LIBRARY_PAGE_ID) continue;
		const path = pagePath(page.id);
		const current = readIfExists(root, path);
		const symbols = byPage.get(page.id);
		if (current === null || current.includes(PLACEHOLDER_MARKER))
			out.set(path, placeholderPage(page, symbols ? renderReference(symbols) : ''));
		else if (symbols)
			out.set(
				pagePath(referencePageId(page.id)),
				referencePage(page, renderReference(symbols, '##')),
			);
	}

	const library = PAGES.find((page) => page.id === LIBRARY_PAGE_ID);
	if (library)
		out.set(
			pagePath(LIBRARY_PAGE_ID),
			libraryPage(readLibrary(root).modules, library.title, library.summary),
		);
	out.set(pagePath(PRESET_TABLES_ID), presetTablesPage());

	const mappingText = readIfExists(root, MAPPING_SOURCE);
	if (mappingText === null) throw new Error(`${MAPPING_SOURCE} is missing`);
	const mapping = JSON.parse(mappingText) as Mapping;
	out.set(MAPPING_PAGE, mappingMarkdown(mapping, false));
	out.set(`${SKILL_MAPPING_DIR}/api-mapping.md`, mappingMarkdown(mapping, true));
	out.set(`${SKILL_MAPPING_DIR}/threejs-mapping.json`, `${JSON.stringify(mapping, null, 2)}\n`);

	for (const [code, entry] of Object.entries(ERRORS))
		out.set(pagePath(`errors/${code}`), errorPage(code, entry));
	out.set(pagePath('errors/index'), errorIndexPage(ERRORS));

	const record = recordFiles(root);
	if (record.size > 0) out.set(RECORD_TABLES_PAGE, recordTablesPage(readRecord(record).rows));

	out.set(pagePath(PAGE_LIST_ID), pageListPage(collectPages(root, out)));
	return out;
}

/** Writes every generated file whose content changed. Returns the paths written. */
export function writeGeneratedDocs(root: string, files: Map<string, string>): string[] {
	const written: string[] = [];
	for (const [path, content] of files) {
		if (readIfExists(root, path) === content) continue;
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
		written.push(path);
	}
	return written;
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
	const note = /^> .*/m.exec(text)?.[0] ?? '';
	const ships = typeof data.since === 'string' ? shipsSentence(data.since) : '';
	if (
		(data.status === 'experimental' || data.status === 'stable') &&
		id !== 'index' &&
		!note.startsWith(`> ${ships}`)
	)
		problems.push(`${path}: the note under the title must start "${ships}"`);
	const named = STEP_AS_RELEASE.exec(text)?.[0];
	if (named)
		problems.push(
			`${path}: names ${named}, a roadmap step and not a release. ${STEPS_NOTE} Say "step ${named.slice(-3)}".`,
		);
	if (data.status !== 'generated' && !inventory.has(id)) {
		problems.push(`${path}: page is not in the inventory in tools/lib/docs.ts`);
	}
	return problems;
}

/** Written API pages that do not link to their generated reference page. */
export function referenceLinkProblems(
	pages: ReadonlyMap<string, string>,
	generated: ReadonlyMap<string, string>,
): string[] {
	return PAGES.filter((page) => generated.has(pagePath(referencePageId(page.id))))
		.filter((page) => !(pages.get(pagePath(page.id)) ?? '').includes(referenceLink(page.id)))
		.map(
			(page) => `${pagePath(page.id)} must link to its API reference, ${referenceLink(page.id)}`,
		);
}

/**
 * Every problem with the docs: exports the API reference cannot show, library items without doc
 * comments, missing pages, bad front matter, broken links, and files of the record of tested
 * devices that break its rules. Generated files count with the content the generator gives them
 * now, so the check needs no generated file on disk.
 */
export function checkDocs(root: string): string[] {
	const problems: string[] = [];
	let generated = new Map<string, string>();
	try {
		const api = readApi(root);
		problems.push(...referenceProblems(api), ...libraryProblems(root));
		generated = generateDocs(root, api);
		problems.push(...readRecord(recordFiles(root)).problems);
	} catch (e) {
		problems.push((e as Error).message);
	}
	const linked = linkedFiles(root);
	for (const [path, content] of generated)
		if (linked.has(path) || path.startsWith('docs/')) linked.set(path, content);
	problems.push(...referenceLinkProblems(linked, generated));
	const inventory = new Set(PAGES.map((p) => p.id));
	for (const page of PAGES) {
		const path = pagePath(page.id);
		if (!generated.has(path) && !existsSync(join(root, path)))
			problems.push(`${path} is missing: run bun run docs`);
	}
	for (const [path, text] of linked) {
		if (!path.startsWith('docs/') || !path.endsWith('.md')) continue;
		problems.push(...frontMatterProblems(path, text, inventory));
		if (/^status: generated$/m.test(text) && !generated.has(path)) {
			problems.push(`${path} is marked generated, but nothing generates it any more: delete it`);
		}
	}
	problems.push(...checkLinkTree(linked, (p) => generated.has(p) || existsSync(join(root, p))));
	return problems;
}
