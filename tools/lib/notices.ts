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

/**
 * Every way that the packages under `root` and the notices page disagree, as `path: problem`:
 * a package with no entry, an entry with no package, a package whose notices the page leaves out,
 * a notices file that its tarball would not carry, or an example add-on that the page leaves out.
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
	return problems;
}
