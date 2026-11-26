// The documentation inventory and every file generated from a single source: the API reference
// on the api/ pages, the page list in docs/index.md, the error
// pages, the tables of the quality presets page, the shader library's page, the three.js mapping
// page with the porting skill's copies of the mapping, and the tables of the record of tested
// devices. Git keeps none of this output (tools/lib/generated.ts). Generation is computed in memory
// first, so the check reads the same content that the generator writes.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ERRORS, type ErrorEntry } from '../../packages/engine/src/errors/codes.ts';
import {
	CHECK_FAR_SHARE,
	CHECK_GRACE_MS,
	CHECK_HOLD_SHARE,
	CHECK_MAX_FPS,
	CHECK_SETTLE_FRAMES,
	CHECK_SETTLE_INTERVAL_MS,
	CHECK_SETTLE_WAIT_MS,
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
import { readIfExists, walkFiles } from './files';
import {
	FIRST_USE_PAGE_ID,
	firstUsePage,
	firstUseProblems,
	manifestFeatures,
} from './first-use-docs';
import { generatedFrontMatter, type PageText, parseFrontMatter } from './frontmatter';
import { checkLinkTree, linkedFiles } from './links';
import { LIBRARY_PAGE_ID, libraryPage, readLibrary } from './shader-library';
import { RECORD_TABLES_PAGE, readRecord, recordFiles, recordTablesPage } from './tested-devices';

/** A page that the navigation shows. A written page's title and summary are its front matter's. */
export type PageEntry = {
	/** Path under docs/ without the .md extension. */
	id: string;
	/** The group of the page's area that holds it, for an area that has groups. */
	group?: string;
} & (
	| { generated?: undefined }
	| {
			/** A generator writes the page, with this title and summary. */
			generated: true;
			title: string;
			summary: string;
	  }
);

export interface AreaEntry {
	/** The first path segment of the area's pages. */
	id: string;
	/** The area's heading in the page list and the website's navigation. */
	title: string;
	/** The area's groups in reading order. An area without groups lists its pages directly. */
	groups?: readonly string[];
}

/** Docs areas in reading order: learning and doing first, reference last. */
export const AREAS: readonly AreaEntry[] = [
	{
		id: 'getting-started',
		title: 'Getting started',
		groups: ['First steps', 'Hosting and licenses'],
	},
	{
		id: 'concepts',
		title: 'Concepts',
		groups: ['How the engine runs', 'Drawing a frame', 'Large scenes', 'Effects after the scene'],
	},
	{
		id: 'guides',
		title: 'Guides',
		groups: [
			'Performance and loading',
			'Shaders and rendering',
			'Pages and UI',
			'Game systems',
			'Example add-ons',
			'Testing and debugging',
			'Building and shipping',
			'Agents and add-ons',
		],
	},
	{ id: 'cookbook', title: 'Cookbook' },
	{ id: 'shaders', title: 'Shaders' },
	{ id: 'porting', title: 'Porting from three.js' },
	{
		id: 'api',
		title: 'API reference',
		groups: [
			'Page and sketch',
			'Scene and objects',
			'Sprites, points, lines and vertex draws',
			'Interaction',
			'Rendering and quality',
			'Utilities',
			'Add-on packages',
			'Building add-ons',
		],
	},
	{ id: 'cli', title: 'Command-line tool' },
	{ id: 'errors', title: 'Errors' },
];

/**
 * Labels that a page may carry in its front matter. Pages carry none unless the owner chooses to
 * mark one, and the website shows a page's labels as tags.
 */
export const STATUSES = ['experimental', 'stable'] as const;

/** A release version, such as "1.2", for a page's optional `since` label. */
const SINCE_FORMAT = /^\d+\.\d+(\.\d+)?$/;

/**
 * Every page that the navigation shows, in reading order: each written page, and the generated
 * pages that sit among them. The check reports a written page that is missing.
 */
// biome-ignore format: one page per line keeps the inventory readable as a table
export const PAGES: readonly PageEntry[] = [
	{ id: 'index' },

	{ id: 'getting-started/install', group: 'First steps' },
	{ id: 'getting-started/first-scene', group: 'First steps' },
	{ id: 'getting-started/project-structure', group: 'First steps' },
	{ id: 'getting-started/hosting', group: 'Hosting and licenses' },
	{ id: 'getting-started/cdn', group: 'Hosting and licenses' },
	{ id: 'getting-started/network-use', group: 'Hosting and licenses' },
	{ id: 'getting-started/third-party-notices', group: 'Hosting and licenses' },

	{ id: 'concepts/architecture', group: 'How the engine runs' },
	{ id: 'concepts/handles', group: 'How the engine runs' },
	{ id: 'concepts/static-dynamic', group: 'How the engine runs' },
	{ id: 'concepts/instances', group: 'How the engine runs' },
	{ id: 'concepts/particle-buffer', group: 'How the engine runs' },
	{ id: 'concepts/assets', group: 'How the engine runs' },
	{ id: 'concepts/backends', group: 'How the engine runs' },
	{ id: 'concepts/quality-presets', group: 'How the engine runs' },
	{ id: 'concepts/quality-preset-tables', title: 'Quality preset tables', summary: "Each preset's starting devices, GPU path caps, check rules and settings.", group: 'How the engine runs', generated: true },
	{ id: 'concepts/color-management', group: 'Drawing a frame' },
	{ id: 'concepts/materials', group: 'Drawing a frame' },
	{ id: 'concepts/lighting', group: 'Drawing a frame' },
	{ id: 'concepts/shadows', group: 'Drawing a frame' },
	{ id: 'concepts/render-layers', group: 'Drawing a frame' },
	{ id: 'concepts/render-graph', group: 'Drawing a frame' },
	{ id: 'concepts/large-worlds', group: 'Large scenes' },
	{ id: 'concepts/culling', group: 'Large scenes' },
	{ id: 'concepts/lod', group: 'Large scenes' },
	{ id: 'concepts/post-processing', group: 'Effects after the scene' },

	{ id: 'guides/performance', group: 'Performance and loading' },
	{ id: 'guides/phones', group: 'Performance and loading' },
	{ id: 'guides/loading-screens', group: 'Performance and loading' },
	{ id: 'guides/first-use-shaders', title: 'Shaders that load on first use', summary: "The features whose shaders download on first use, which createEngine's preload takes.", group: 'Performance and loading', generated: true },
	{ id: 'guides/start-time', group: 'Performance and loading' },
	{ id: 'guides/custom-shaders', group: 'Shaders and rendering' },
	{ id: 'guides/custom-passes', group: 'Shaders and rendering' },
	{ id: 'guides/baked-light-data', group: 'Shaders and rendering' },
	{ id: 'guides/ui-overlays', group: 'Pages and UI' },
	{ id: 'guides/content-pages', group: 'Pages and UI' },
	{ id: 'guides/accessibility', group: 'Pages and UI' },
	{ id: 'guides/multiple-views', group: 'Pages and UI' },
	{ id: 'guides/video-textures', group: 'Pages and UI' },
	{ id: 'guides/physics', group: 'Game systems' },
	{ id: 'guides/deterministic-simulation', group: 'Game systems' },
	{ id: 'guides/audio', group: 'Game systems' },
	{ id: 'guides/car-paint', group: 'Example add-ons' },
	{ id: 'guides/lens-kit', group: 'Example add-ons' },
	{ id: 'guides/screens', group: 'Example add-ons' },
	{ id: 'guides/testing', group: 'Testing and debugging' },
	{ id: 'guides/debugging', group: 'Testing and debugging' },
	{ id: 'guides/assets-pipeline', group: 'Building and shipping' },
	{ id: 'guides/deploying', group: 'Building and shipping' },
	{ id: 'guides/agents', group: 'Agents and add-ons' },
	{ id: 'guides/add-ons', group: 'Agents and add-ons' },

	{ id: 'cookbook/index' },

	{ id: 'shaders/surface-functions' },
	{ id: 'shaders/builtins' },
	{ id: 'shaders/library', title: 'Shader library and imports', summary: 'The WGSL modules that ship with the engine: math, noise, color, lighting, fog, vertex, depth and signed distance helpers, and how to import them.', generated: true },
	{ id: 'shaders/wgsl-rules' },

	{ id: 'porting/threejs-overview' },
	{ id: 'porting/threejs-mapping', title: 'three.js to null3D mapping', summary: 'Every three.js API a port is likely to meet, with its null3D equivalent.', generated: true },
	{ id: 'porting/threejs-loop-and-threads' },
	{ id: 'porting/threejs-materials' },
	{ id: 'porting/threejs-shaders' },
	{ id: 'porting/threejs-postprocessing' },
	{ id: 'porting/react-three-fiber' },
	{ id: 'porting/threejs-unsupported' },
	{ id: 'porting/verification' },

	{ id: 'api/engine', group: 'Page and sketch' },
	{ id: 'api/sketch', group: 'Page and sketch' },
	{ id: 'api/page', group: 'Page and sketch' },
	{ id: 'api/scene', group: 'Scene and objects' },
	{ id: 'api/objects', group: 'Scene and objects' },
	{ id: 'api/cameras', group: 'Scene and objects' },
	{ id: 'api/lights', group: 'Scene and objects' },
	{ id: 'api/geometry', group: 'Scene and objects' },
	{ id: 'api/materials', group: 'Scene and objects' },
	{ id: 'api/textures', group: 'Scene and objects' },
	{ id: 'api/assets', group: 'Scene and objects' },
	{ id: 'api/animation', group: 'Scene and objects' },
	{ id: 'api/sprites', group: 'Sprites, points, lines and vertex draws' },
	{ id: 'api/points', group: 'Sprites, points, lines and vertex draws' },
	{ id: 'api/lines', group: 'Sprites, points, lines and vertex draws' },
	{ id: 'api/vertex-draws', group: 'Sprites, points, lines and vertex draws' },
	{ id: 'api/input', group: 'Interaction' },
	{ id: 'api/raycast', group: 'Interaction' },
	{ id: 'api/ui', group: 'Interaction' },
	{ id: 'api/controls', group: 'Interaction' },
	{ id: 'api/post', group: 'Rendering and quality' },
	{ id: 'api/render', group: 'Rendering and quality' },
	{ id: 'api/quality', group: 'Rendering and quality' },
	{ id: 'api/debug', group: 'Rendering and quality' },
	{ id: 'api/time', group: 'Utilities' },
	{ id: 'api/math', group: 'Utilities' },
	{ id: 'api/particles', group: 'Add-on packages' },
	{ id: 'api/impostors', group: 'Add-on packages' },
	{ id: 'api/terrain', group: 'Add-on packages' },
	{ id: 'api/grass', group: 'Add-on packages' },
	{ id: 'api/splats', group: 'Add-on packages' },
	{ id: 'api/water', group: 'Add-on packages' },
	{ id: 'api/wind', group: 'Add-on packages' },
	{ id: 'api/sound', group: 'Add-on packages' },
	{ id: 'api/three-compat', group: 'Add-on packages' },
	{ id: 'api/features', group: 'Building add-ons' },
	{ id: 'api/feature-draws', group: 'Building add-ons' },
	{ id: 'api/feature-effects', group: 'Building add-ons' },
	{ id: 'api/feature-instances', group: 'Building add-ons' },
	{ id: 'api/tasks', group: 'Building add-ons' },

	{ id: 'cli/null3d' },

	{ id: 'errors/index', title: 'Error codes', summary: 'Every EngineError code with its cause and fix.', generated: true },
];

/** The generated page that lists every docs page. */
export const PAGE_LIST_ID = 'pages';
/** The generated navigation that the website reads: areas, their groups and their pages. */
export const NAV_FILE = 'docs/nav.json';
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
	const rows = settingRows()
		.filter((row) => row.built)
		.map((row) => [
			`${row.label} (\`${row.name}\`)`,
			...row.values.map(tableCell),
			CHANGE_DOCS[row.changes],
		]);
	return markdownTable(['Setting', ...QUALITY_PRESETS.map(presetTitle), 'Changes'], rows);
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
			'A preset is far below its target',
			`Under ${CHECK_FAR_SHARE * 100}% of the target: the check lowers it straight to Low`,
		],
		[
			'Wait before the first measurement and after each lowering',
			`Until the pipelines are built, then until the GPU has finished ${CHECK_SETTLE_FRAMES} frames within ${CHECK_SETTLE_INTERVAL_MS} ms each, for ${CHECK_SETTLE_WAIT_MS} ms at most`,
		],
		[
			'Frames drawn before each measurement',
			`${CHECK_GRACE_MS} ms, and up to ${CHECK_UPLOAD_WAIT_MS} ms more while textures upload`,
		],
		['Measurement of each preset', `${CHECK_WINDOW_MS} ms`],
	];
	return markdownTable(['Rule', 'Value'], rows);
}

/** The page of the quality presets' tables, from the chooser's constants and the preset table. */
export function presetTablesPage(text: PageText): string {
	return `${generatedFrontMatter(PRESET_TABLES_ID, text.title, text.summary)}
# ${text.title}

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
const MAPPING_PAGE_ID = 'porting/threejs-mapping';
/** The generated list of every error code. */
const ERROR_INDEX_ID = 'errors/index';
const SKILL_MAPPING_DIR = 'skills/null3d-port-threejs/references';

/** Docs areas: the first path segment of every page ID. */
export const DOC_AREAS = new Set(AREAS.map((area) => area.id));

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

/**
 * The generated reference page of a written API page: its exports, from their doc comments.
 * `title` is the written page's title.
 */
export function referencePage(id: string, title: string, reference: string): string {
	return `${generatedFrontMatter(referencePageId(id), `${title}: API reference`, `Every export of the ${title} API, from the engine's doc comments.`)}
# ${title}: API reference

> [${title}](../${id.slice('api/'.length)}.md) explains these exports. The engine's doc comments make this page.

${reference}
`;
}

/**
 * Maintainer guides that AGENTS.md's table of paths or the guides' own README does not link: each
 * Markdown file directly in `.dev/`, apart from the README and the generated tables.
 */
export function guideListProblems(root: string): string[] {
	const guides = walkFiles(root, '.dev', (path) => /^\.dev\/[^/]+\.md$/.test(path)).filter(
		(path) => path !== '.dev/README.md' && path !== RECORD_TABLES_PAGE,
	);
	const agents = readIfExists(root, 'AGENTS.md') ?? '';
	const readme = readIfExists(root, '.dev/README.md') ?? '';
	return guides.flatMap((path) => {
		const name = path.slice('.dev/'.length);
		return [
			...(agents.includes(`(${path})`) ? [] : [`AGENTS.md's row of .dev/ does not link ${path}`]),
			...(readme.includes(`(${name})`) ? [] : [`.dev/README.md does not list ${path}`]),
		];
	});
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
	notes?: string;
	docs: string;
}

interface Mapping {
	statusLegend: Record<string, string>;
	entries: MappingEntry[];
}

/** The mapping as a docs page, or as the port skill's copy, which has no front matter. */
export function mappingMarkdown(mapping: Mapping, text: PageText, forSkill: boolean): string {
	const lines: string[] = [];
	if (!forSkill) lines.push(generatedFrontMatter(MAPPING_PAGE_ID, text.title, text.summary));
	lines.push(`# ${text.title}\n`);
	lines.push('Status values:\n');
	for (const [key, text] of Object.entries(mapping.statusLegend))
		lines.push(`- \`${key}\`: ${text}`);
	lines.push('');
	const categories = [...new Set(mapping.entries.map((e) => e.category))];
	if (forSkill) {
		lines.push('## Contents\n');
		for (const c of categories) lines.push(`- ${c}`);
		lines.push('');
	}
	for (const c of categories) {
		lines.push(`## ${c}\n`);
		lines.push('| three.js | null3D | Status | Notes | Docs |');
		lines.push('| --- | --- | --- | --- | --- |');
		for (const e of mapping.entries.filter((x) => x.category === c)) {
			lines.push(
				`| ${tableCell(e.three)} | ${tableCell(e.target)} | ${e.status} | ${tableCell(e.notes)} | \`${e.docs}\` |`,
			);
		}
		lines.push('');
	}
	return lines.join('\n');
}

/** A collapsible block of dense detail, with blank lines around its body. */
function detailsBlock(summary: string, body: string): string {
	return `<details>\n<summary>${summary}</summary>\n\n${body.trim()}\n\n</details>`;
}

/** The docs page of one error code, generated from the engine's error table. */
export function errorPage(
	code: string,
	entry: ErrorEntry,
	pages: ReadonlyMap<string, PageInfo> = new Map(),
): string {
	const parts = [
		generatedFrontMatter(`errors/${code}`, `${code}: ${entry.title}`, entry.cause),
		`# ${code}: ${entry.title}`,
		'',
		'## What happened',
		'',
		entry.cause,
	];
	if (entry.reaches) parts.push('', entry.reaches);
	if (entry.cases?.length) {
		parts.push('');
		for (const one of entry.cases) parts.push(`- ${one}`);
	}
	if (entry.details)
		parts.push('', detailsBlock('Technical details: limits and edge cases', entry.details));
	parts.push('', '## How to fix it', '', entry.fix);
	if (/\breport (it|the error)\b/i.test(entry.fix)) {
		parts.push(
			'',
			'Report engine bugs on [GitHub Issues](https://github.com/null3d-engine/null3d/issues). Add the full message and [engine.report](../guides/debugging.md#how-the-engine-runs-on-this-device).',
		);
	}
	if (entry.fixCases?.length) {
		parts.push('');
		for (const one of entry.fixCases) parts.push(`- ${one}`);
	}
	if (entry.fixDetails)
		parts.push('', detailsBlock('Technical details: fixes for each case', entry.fixDetails));
	parts.push(
		'',
		'[Where problems appear](../guides/debugging.md#where-problems-appear) says where each kind of error reaches your code.',
		'',
		'## Example message',
		'',
		'The engine prints the part below, then the fix above and a link to this page.',
		'',
		'```text',
		entry.example,
		'```',
		'',
		'## See also',
		'',
	);
	const related = [...new Set([...(entry.see ?? []), ERROR_INDEX_ID, 'guides/debugging'])];
	for (const id of related) {
		if (id === ERROR_INDEX_ID) {
			parts.push('- [Error codes](index.md)');
			continue;
		}
		const title = pages.get(id)?.title ?? id;
		parts.push(`- [${title}](../${id}.md)`);
	}
	return `${parts.join('\n')}\n`;
}

/** The headings of the error index, by the first two digits of each code. */
const ERROR_GROUPS: readonly [string, string][] = [
	['11', 'Objects, handles and engine memory'],
	['12', 'Values passed to calls'],
	['13', 'Browsers and GPUs'],
	['14', 'Setup, loading and runtime'],
	['15', 'Render graph'],
];

/** The list of every error code, generated from the engine's error table. */
export function errorIndexPage(errors: Record<string, ErrorEntry>, text: PageText): string {
	const groups = new Map<string, [string, ErrorEntry][]>();
	for (const [code, entry] of Object.entries(errors).sort(([a], [b]) => a.localeCompare(b))) {
		const prefix = code.slice(1, 3);
		const rows = groups.get(prefix) ?? [];
		rows.push([code, entry]);
		groups.set(prefix, rows);
	}
	const parts = [
		generatedFrontMatter(ERROR_INDEX_ID, text.title, text.summary),
		`# ${text.title}`,
		'',
		"Every error the engine reports is an `EngineError` with a code. Its message names the call and the object, says what failed and how to fix it, and links to the code's page here. [Where problems appear](../guides/debugging.md#where-problems-appear) says where each kind of error reaches your code.",
		'',
		"Codes from E2000 to E9999 belong to add-ons. An add-on's message starts with its name, such as `splats E2101`, and the add-on's page lists its codes: [Gaussian splats](../api/splats.md), [Sound](../api/sound.md).",
	];
	const known = new Set(ERROR_GROUPS.map(([prefix]) => prefix));
	for (const [prefix, title] of ERROR_GROUPS) {
		const rows = groups.get(prefix);
		if (!rows?.length) continue;
		parts.push('', `## ${title}`, '', '| Code | Error | What happened |', '| --- | --- | --- |');
		for (const [code, entry] of rows)
			parts.push(
				`| [${code}](${code}.md) | ${tableCell(entry.title)} | ${tableCell(entry.cause)} |`,
			);
	}
	const rest = [...groups.entries()].filter(([prefix]) => !known.has(prefix));
	for (const [, rows] of rest) {
		parts.push(
			'',
			'## Other errors',
			'',
			'| Code | Error | What happened |',
			'| --- | --- | --- |',
		);
		for (const [code, entry] of rows)
			parts.push(
				`| [${code}](${code}.md) | ${tableCell(entry.title)} | ${tableCell(entry.cause)} |`,
			);
	}
	return `${parts.join('\n')}\n`;
}

export interface PageInfo {
	id: string;
	title: string;
	summary: string;
}

/** One area of the website's navigation: its groups, each with its pages in reading order. */
export interface NavArea {
	id: string;
	title: string;
	groups: { title: string | null; pages: string[] }[];
}

/**
 * The navigation, from the areas and the inventory: each area's groups in order, or one group
 * with no title for an area without groups. The docs home is not in an area.
 */
export function navigation(): NavArea[] {
	return AREAS.map((area) => {
		const inArea = PAGES.filter((p) => p.id.split('/')[0] === area.id);
		const groups = area.groups
			? area.groups.map((title) => ({
					title,
					pages: inArea.filter((p) => p.group === title).map((p) => p.id),
				}))
			: [{ title: null, pages: inArea.map((p) => p.id) }];
		return { id: area.id, title: area.title, groups };
	});
}

/**
 * Problems with the areas and the inventory: a page outside every area, in no group or a wrong
 * one, a group with no pages, and a written page's entry that carries a title or summary, which
 * its front matter holds.
 */
export function inventoryProblems(
	pages: readonly PageEntry[] = PAGES,
	areas: readonly AreaEntry[] = AREAS,
): string[] {
	const problems: string[] = [];
	const seen = new Set<string>();
	for (const page of pages) {
		if (seen.has(page.id)) problems.push(`${page.id} is in the inventory twice`);
		seen.add(page.id);
		if (!page.generated && ('title' in page || 'summary' in page))
			problems.push(
				`${page.id} is a written page; its title and summary belong in its front matter`,
			);
		if (page.id === 'index') continue;
		const area = areas.find((a) => a.id === page.id.split('/')[0]);
		if (!area) problems.push(`${page.id} is in no area of AREAS`);
		else if (area.groups && !area.groups.includes(page.group ?? ''))
			problems.push(`${page.id} needs a group of ${area.id}: ${area.groups.join(', ')}`);
		else if (!area.groups && page.group)
			problems.push(`${page.id} has a group, but ${area.id} has no groups`);
	}
	for (const area of areas)
		for (const group of area.groups ?? [])
			if (!pages.some((p) => p.group === group && p.id.startsWith(`${area.id}/`)))
				problems.push(`the group ${group} of ${area.id} has no pages`);
	return problems;
}

/** The title and summary of a generated page in the inventory. */
function generatedText(id: string): PageText {
	const page = PAGES.find((p) => p.id === id);
	if (!page?.generated) throw new Error(`${id} needs an inventory entry with generated: true`);
	return { title: page.title, summary: page.summary };
}

/** The title and summary of each page, from front matter, preferring content about to be generated. */
function collectPages(root: string, generated: Map<string, string>): Map<string, PageInfo> {
	const out = new Map<string, PageInfo>();
	for (const page of PAGES) {
		const path = pagePath(page.id);
		const text = generated.get(path) ?? readIfExists(root, path);
		const data = text === null ? undefined : parseFrontMatter(text)?.data;
		if (data)
			out.set(page.id, {
				id: page.id,
				title: String(data.title ?? ''),
				summary: String(data.summary ?? ''),
			});
	}
	return out;
}

/** The list of pages: each area of the navigation, its groups, and a row for each page. */
export function pageList(nav: readonly NavArea[], pages: ReadonlyMap<string, PageInfo>): string {
	const table = (ids: readonly string[]) => [
		'| Page | What it covers |',
		'| --- | --- |',
		...ids.flatMap((id) => {
			const p = pages.get(id);
			return p ? [`| [${tableCell(p.title)}](${id}.md) | ${tableCell(p.summary)} |`] : [];
		}),
	];
	return nav
		.map((area) =>
			[
				`## ${area.title}`,
				...area.groups.flatMap((g) => [
					'',
					...(g.title ? [`### ${g.title}`, ''] : []),
					...table(g.pages),
				]),
			].join('\n'),
		)
		.join('\n\n');
}

/** The generated page that lists every page of the navigation, by area and group. */
export function pageListPage(
	nav: readonly NavArea[],
	pages: ReadonlyMap<string, PageInfo>,
): string {
	return `${generatedFrontMatter(PAGE_LIST_ID, 'All pages', 'The docs pages of each area and group.')}
# All pages

> The docs generator writes this list from the docs inventory and each page's front matter. [Error codes](errors/index.md) lists every error code.

${pageList(nav, pages)}
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
		const symbols = byPage.get(page.id);
		const written = page.generated || !symbols ? null : readIfExists(root, pagePath(page.id));
		const title = written === null ? undefined : parseFrontMatter(written)?.data.title;
		if (symbols && typeof title === 'string')
			out.set(
				pagePath(referencePageId(page.id)),
				referencePage(page.id, title, renderReference(symbols, '##')),
			);
	}

	const library = generatedText(LIBRARY_PAGE_ID);
	out.set(
		pagePath(LIBRARY_PAGE_ID),
		libraryPage(readLibrary(root).modules, library.title, library.summary),
	);
	out.set(pagePath(PRESET_TABLES_ID), presetTablesPage(generatedText(PRESET_TABLES_ID)));
	out.set(
		pagePath(FIRST_USE_PAGE_ID),
		firstUsePage(manifestFeatures(root), generatedText(FIRST_USE_PAGE_ID)),
	);

	const mappingText = readIfExists(root, MAPPING_SOURCE);
	if (mappingText === null) throw new Error(`${MAPPING_SOURCE} is missing`);
	const mapping = JSON.parse(mappingText) as Mapping;
	const mappingPage = generatedText(MAPPING_PAGE_ID);
	out.set(pagePath(MAPPING_PAGE_ID), mappingMarkdown(mapping, mappingPage, false));
	out.set(`${SKILL_MAPPING_DIR}/api-mapping.md`, mappingMarkdown(mapping, mappingPage, true));
	out.set(`${SKILL_MAPPING_DIR}/threejs-mapping.json`, `${JSON.stringify(mapping, null, 2)}\n`);

	const pages = collectPages(root, out);
	for (const [code, entry] of Object.entries(ERRORS))
		out.set(pagePath(`errors/${code}`), errorPage(code, entry, pages));
	out.set(pagePath(ERROR_INDEX_ID), errorIndexPage(ERRORS, generatedText(ERROR_INDEX_ID)));

	const record = recordFiles(root);
	if (record.size > 0) out.set(RECORD_TABLES_PAGE, recordTablesPage(readRecord(record).rows));

	const nav = navigation();
	out.set(pagePath(PAGE_LIST_ID), pageListPage(nav, pages));
	out.set(NAV_FILE, `${JSON.stringify({ areas: nav }, null, 2)}\n`);
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
	if (data.status === 'planned') {
		problems.push(
			`${path}: status "planned" is not allowed, because the docs name no feature that the engine lacks. Write the page, or take it out of the inventory and list it in .dev/gaps.md`,
		);
	} else if (
		data.status !== undefined &&
		!STATUSES.includes(data.status as (typeof STATUSES)[number])
	) {
		problems.push(`${path}: status "${String(data.status)}" must be one of ${STATUSES.join(', ')}`);
	}
	if (
		data.since !== undefined &&
		(typeof data.since !== 'string' || !SINCE_FORMAT.test(data.since))
	) {
		problems.push(`${path}: since "${String(data.since)}" must be a quoted release such as "1.2"`);
	}
	if (data.generated !== undefined && data.generated !== true)
		problems.push(`${path}: generated must be true, or left out`);
	if (data.generated !== true && !inventory.has(id)) {
		problems.push(`${path}: page is not in the inventory in tools/lib/docs.ts`);
	}
	return problems;
}

/** The committed map of old page IDs to new ones, which the website turns into redirects. */
export const MOVES_FILE = 'docs/moves.json';

/**
 * Problems with the moves file: an entry whose old ID is a page again, or whose new ID leads to
 * no page. `previous` is the file on main, whose entries must all stay, because old engine builds
 * and package READMEs link to old IDs for good.
 */
export function movesProblems(
	text: string | null,
	isPage: (id: string) => boolean,
	previous: string | null = null,
): string[] {
	if (text === null) return [`${MOVES_FILE} is missing; it holds {} when no page has moved`];
	let moves: Record<string, unknown>;
	try {
		moves = JSON.parse(text);
	} catch (e) {
		return [`${MOVES_FILE} is not valid JSON (${(e as Error).message})`];
	}
	const problems: string[] = [];
	for (const [from, to] of Object.entries(moves)) {
		if (typeof to !== 'string') {
			problems.push(`${MOVES_FILE}: ${from} must map to a page ID`);
			continue;
		}
		if (isPage(from))
			problems.push(`${MOVES_FILE}: ${from} is a page again; a moved ID stays free`);
		let target = to;
		const seen = new Set([from]);
		while (typeof moves[target] === 'string' && !seen.has(target)) {
			seen.add(target);
			target = moves[target] as string;
		}
		if (!isPage(target))
			problems.push(`${MOVES_FILE}: ${from} leads to ${target}, which is not a page`);
	}
	if (previous !== null) {
		let before: Record<string, unknown> = {};
		try {
			before = JSON.parse(previous);
		} catch (e) {
			problems.push(`${MOVES_FILE} on main is not valid JSON (${(e as Error).message})`);
		}
		for (const from of Object.keys(before))
			if (!(from in moves))
				problems.push(`${MOVES_FILE}: the entry for ${from} was removed; keep it`);
	}
	return problems;
}

/**
 * Generated pages that the inventory does not place, and inventory entries marked generated that
 * no generator writes. The API reference pages, the error code pages and the page list stay out.
 */
export function placementProblems(generated: ReadonlyMap<string, string>): string[] {
	const placed = new Set(PAGES.filter((p) => p.generated).map((p) => p.id));
	const unplaced = [...generated.keys()]
		.filter((path) => path.startsWith('docs/') && path.endsWith('.md'))
		.map((path) => path.slice('docs/'.length, -'.md'.length))
		.filter(
			(id) =>
				!placed.has(id) &&
				id !== PAGE_LIST_ID &&
				!id.startsWith(`${REFERENCE_AREA}/`) &&
				!/^errors\/E\d+$/.test(id),
		)
		.map((id) => `${id} is generated, but the inventory does not place it`);
	const unwritten = [...placed]
		.filter((id) => !generated.has(pagePath(id)))
		.map((id) => `${id} is marked generated in the inventory, but no generator writes it`);
	return [...unplaced, ...unwritten];
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
 * devices that break its rules, the inventory's areas and groups, and the moves file. Generated
 * files count with the content the generator gives them now, so the check needs no generated file
 * on disk. `previousMoves` is the moves file on main, whose entries must stay.
 */
export function checkDocs(root: string, previousMoves: string | null = null): string[] {
	const problems: string[] = [];
	let generated = new Map<string, string>();
	try {
		const api = readApi(root);
		problems.push(
			...referenceProblems(api),
			...libraryProblems(root),
			...firstUseProblems(manifestFeatures(root)),
			...guideListProblems(root),
		);
		generated = generateDocs(root, api);
		problems.push(...readRecord(recordFiles(root)).problems);
	} catch (e) {
		problems.push((e as Error).message);
	}
	const linked = linkedFiles(root);
	for (const [path, content] of generated)
		if (linked.has(path) || path.startsWith('docs/')) linked.set(path, content);
	problems.push(
		...referenceLinkProblems(linked, generated),
		...inventoryProblems(),
		...placementProblems(generated),
		...movesProblems(
			readIfExists(root, MOVES_FILE),
			(id) => generated.has(pagePath(id)) || existsSync(join(root, pagePath(id))),
			previousMoves,
		),
	);
	const inventory = new Set(PAGES.map((p) => p.id));
	for (const page of PAGES) {
		const path = pagePath(page.id);
		if (!generated.has(path) && !existsSync(join(root, path)))
			problems.push(`${path} is missing: run bun run docs`);
	}
	for (const [path, text] of linked) {
		if (!path.startsWith('docs/') || !path.endsWith('.md')) continue;
		problems.push(...frontMatterProblems(path, text, inventory));
		if (/^generated: true$/m.test(text) && !generated.has(path)) {
			problems.push(`${path} is marked generated, but nothing generates it any more: delete it`);
		}
	}
	problems.push(...checkLinkTree(linked, (p) => generated.has(p) || existsSync(join(root, p))));
	return problems;
}
