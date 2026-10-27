// Guards the notices promise: every package and every example add-on has an entry on the notices
// page that names its third-party code, the version where one applies, and the license. A package
// that ships another project's code carries that project's licence text, lists the file in its
// tarball, and exports its package.json, which the Vite plugin resolves to find the text.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The page that lists every package's third-party code. */
export const NOTICES_PAGE = 'docs/getting-started/third-party-notices.md';

/** The file in which a package lists the third-party code that it ships. */
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt';

/** A licence whose text a copy has to carry, as the page names it. */
const LICENCE = /\b(?:MIT|Apache|BSD|ISC|Zlib|Unlicense)\b/;

/** A project whose code a package ships, and the words that name it. */
interface Upstream {
	/** The name to give in a failure. */
	readonly name: string;
	/** The text that a package's notices must hold, lowercased. */
	readonly notice: string;
	/** How shipped source names the project. */
	readonly pattern: RegExp;
	/** How a decision record names the project where it claims the port. */
	readonly claim: RegExp;
}

/**
 * The projects whose code the packages translate or copy. A package whose shipped text names one
 * carries it in its notices file. A method or a formula from a paper is not a project, so it does
 * not belong here.
 */
const UPSTREAMS: readonly Upstream[] = [
	{ name: 'three.js', notice: 'three.js', pattern: /three\.js/i, claim: /three\.js/i },
	{ name: 'Filament', notice: 'filament', pattern: /Filament/, claim: /Filament/ },
	{ name: 'KinoBokeh', notice: 'kinobokeh', pattern: /KinoBokeh/, claim: /KinoBokeh/ },
	{
		name: "Unity's post-processing stack v1",
		notice: "unity's post-processing stack",
		pattern: /Unity['’]?s?\s+post-processing|Unity Technologies/i,
		claim: /Unity['’]?s?\s+post-processing|Unity post-processing|Unity Technologies/i,
	},
	{
		name: 'AMD FidelityFX',
		notice: 'amd fidelityfx',
		pattern: /FidelityFX/,
		claim: /FidelityFX|FSR ?1\b/i,
	},
	{
		name: 'Qualcomm Snapdragon GSR',
		notice: 'qualcomm snapdragon',
		pattern: /Qualcomm|Snapdragon/,
		claim: /Snapdragon GSR|GSR ?1\b|Qualcomm Innovation Center/i,
	},
];

/** The words with which a decision record claims that code is a port. */
const PORT_CLAIM =
	/\b(?:port(?:s|ed|ing)?|transcrib\w*|copied|translated|adapted|derived|gather\s+of|follows?)\b/i;

/** The source trees whose text a package ships, beside the files under its own source folder. */
const SHIPPED_TREES: Readonly<Record<string, readonly string[]>> = {
	engine: [
		'packages/engine/src',
		'crates/null3d-shaders/wgsl',
		'crates/null3d-render/src',
		'crates/null3d-core/src',
		'crates/null3d-assets-wasm/src',
	],
	'vite-plugin': ['packages/vite-plugin/src', 'crates/null3d-shaders/wgsl'],
	cli: ['packages/cli/src', 'crates/null3d-assets-wasm/src'],
};

/** A shipped source file whose text names an upstream. */
const SOURCE_FILE = /\.(?:wgsl|rs|ts|js|mjs|cjs)$/;

/**
 * A path outside the shipped source: a test, or a generated file. A generated shader module holds
 * compiled text from the WGSL sources that the check already reads.
 */
const EXCLUDED_PATH = /(?:\.test\.|\.spec\.|\/tests?\/|\/__tests__\/|\/generated\/)/;

/** One package's row of the page's per-package table. */
interface Entry {
	readonly thirdParty: string;
	readonly license: string;
	readonly notices: string;
}

/** The section of the page between the heading that `start` names and the next heading. */
function sectionOf(page: string, start: string): string {
	const at = page.indexOf(start);
	if (at < 0) return '';
	const rest = page.slice(at + start.length);
	const end = rest.search(/\n## /);
	return end < 0 ? rest : rest.slice(0, end);
}

/** Each package's row of the page's per-package table, by package folder. */
function entriesOf(page: string): Map<string, Entry> {
	const entries = new Map<string, Entry>();
	for (const line of sectionOf(page, '## Each package').split('\n')) {
		if (!line.startsWith('|')) continue;
		const cells = line
			.split('|')
			.map((cell) => cell.trim())
			.filter((cell, index, all) => cell !== '' || (index !== 0 && index !== all.length - 1));
		const name = cells[0]?.match(/^`@null3d\/([a-z0-9-]+)`$/)?.[1];
		if (name === undefined) continue;
		entries.set(name, {
			thirdParty: cells[1] ?? '',
			license: cells[2] ?? '',
			notices: cells[cells.length - 1] ?? '',
		});
	}
	return entries;
}

/** A package's manifest, or nothing that the checks can use when it does not parse. */
function manifestOf(dir: string): { files?: string[]; exports?: Record<string, unknown> } {
	try {
		return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	} catch {
		return {};
	}
}

/** Every source file under `folder`, in path order, without its tests. */
function sourceFiles(folder: string): string[] {
	if (!existsSync(folder)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) {
			if (!EXCLUDED_PATH.test(`${path}/`)) files.push(...sourceFiles(path));
		} else if (SOURCE_FILE.test(entry.name) && !EXCLUDED_PATH.test(path)) {
			files.push(path);
		}
	}
	return files;
}

/** A text with its comment markers and runs of whitespace folded to one space each. */
function folded(text: string): string {
	return text.replace(/\/\*|\*\/|\/\/|\s+/g, ' ').trim();
}

/**
 * The ways that an upstream's claim and the notices disagree: shipped code that names a project
 * whose notice its package leaves out, or a decision record that claims a port that the engine's
 * notices leave out.
 */
function upstreamProblems(root: string): string[] {
	const problems: string[] = [];
	const packageRoot = join(root, 'packages');
	if (!existsSync(packageRoot)) return problems;
	for (const name of readdirSync(packageRoot).sort()) {
		const dir = join(packageRoot, name);
		const trees = SHIPPED_TREES[name] ?? [`packages/${name}/src`];
		const text = folded(
			trees
				.map((tree) =>
					sourceFiles(join(root, tree))
						.map((file) => readFileSync(file, 'utf8'))
						.join('\n'),
				)
				.join('\n'),
		);
		if (text === '') continue;
		const noticesPath = join(dir, NOTICES_FILE);
		const hasNotices = existsSync(noticesPath);
		const notices = hasNotices ? folded(readFileSync(noticesPath, 'utf8')).toLowerCase() : '';
		for (const upstream of UPSTREAMS) {
			if (!upstream.pattern.test(text) || notices.includes(upstream.notice)) continue;
			problems.push(
				hasNotices
					? `packages/${name}: its shipped code names ${upstream.name}, and ${NOTICES_FILE} does not`
					: `packages/${name}: its shipped code names ${upstream.name}, and the package ships no ${NOTICES_FILE}`,
			);
		}
	}
	const engineNoticesPath = join(packageRoot, 'engine', NOTICES_FILE);
	const engineNotices = existsSync(engineNoticesPath)
		? folded(readFileSync(engineNoticesPath, 'utf8')).toLowerCase()
		: '';
	const decisionsRoot = join(root, '.dev/decisions');
	if (!existsSync(decisionsRoot)) return problems;
	const seen = new Set<string>();
	for (const file of readdirSync(decisionsRoot)
		.filter((name) => name.endsWith('.md'))
		.sort()) {
		const page = readFileSync(join(decisionsRoot, file), 'utf8');
		for (const paragraph of page.split(/\n\s*\n/)) {
			const text = folded(paragraph);
			if (!PORT_CLAIM.test(text)) continue;
			for (const upstream of UPSTREAMS) {
				const key = `${file}: ${upstream.name}`;
				if (!upstream.claim.test(text) || engineNotices.includes(upstream.notice)) continue;
				if (seen.has(key)) continue;
				seen.add(key);
				problems.push(
					`.dev/decisions/${file}: claims ${upstream.name} as a port, and the engine's ${NOTICES_FILE} does not name it`,
				);
			}
		}
	}
	return problems;
}

/**
 * Every way that the packages under `root` and the notices page disagree, as `path: problem`:
 * a package with no entry, an entry with no package, a package whose notices the page leaves out,
 * a notices file that its tarball would not carry, an example add-on that the page leaves out, or
 * shipped code and a decision record that claim an upstream that the notices leave out.
 */
export function noticesProblems(root: string): string[] {
	const problems: string[] = [];
	const pagePath = join(root, NOTICES_PAGE);
	if (!existsSync(pagePath)) return [`${NOTICES_PAGE}: missing`];
	const page = readFileSync(pagePath, 'utf8');
	const entries = entriesOf(page);
	const packageRoot = join(root, 'packages');
	const packages = existsSync(packageRoot) ? readdirSync(packageRoot).sort() : [];
	for (const name of packages) {
		const dir = join(packageRoot, name);
		const entry = entries.get(name);
		const hasNotices = existsSync(join(dir, NOTICES_FILE));
		if (!entry) {
			problems.push(
				`packages/${name}: has no row on ${NOTICES_PAGE}. Add its upstream, version and license, or say that it ships only its own code`,
			);
			continue;
		}
		if (!hasNotices) {
			if (!/^none\b/i.test(entry.thirdParty))
				problems.push(
					`packages/${name}: the page names third-party code, and the package ships no ${NOTICES_FILE}`,
				);
			if (!/^none$/i.test(entry.license) || !/^none$/i.test(entry.notices))
				problems.push(
					`packages/${name}: ships only its own code, so the page gives it no license and no notices file`,
				);
			continue;
		}
		if (/^none\b/i.test(entry.thirdParty))
			problems.push(
				`packages/${name}: ships ${NOTICES_FILE}, and the page says it ships only its own code`,
			);
		if (!LICENCE.test(entry.license))
			problems.push(`packages/${name}: the page names no license for its third-party code`);
		if (!entry.notices.includes(NOTICES_FILE))
			problems.push(`packages/${name}: the page does not name ${NOTICES_FILE}`);
		const manifest = manifestOf(dir);
		if (!(manifest.files ?? []).includes(NOTICES_FILE))
			problems.push(`packages/${name}: package.json files does not list ${NOTICES_FILE}`);
		if (manifest.exports?.['./package.json'] === undefined)
			problems.push(
				`packages/${name}: package.json exports does not offer ./package.json, which the Vite plugin resolves to find the notices`,
			);
	}
	for (const name of entries.keys())
		if (!packages.includes(name))
			problems.push(`${NOTICES_PAGE}: has a row for ${name}, and packages/${name} does not exist`);
	const addonsRoot = join(root, 'examples/addons');
	const addonsSection = sectionOf(page, '## The example add-ons');
	const addons = existsSync(addonsRoot)
		? readdirSync(addonsRoot).filter((name) => statSync(join(addonsRoot, name)).isDirectory())
		: [];
	for (const name of addons)
		if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(addonsSection))
			problems.push(
				`examples/addons/${name}: has no entry on ${NOTICES_PAGE}. Name its upstream and license, or say that it ships only its own code`,
			);
	problems.push(...upstreamProblems(root));
	return problems;
}
