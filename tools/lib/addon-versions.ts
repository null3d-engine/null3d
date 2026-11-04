// Checks that each add-on package stops a page that runs another engine version, as the add-on
// rules require (AGENTS.md "Parity with three.js and add-on modules", rule 13). An add-on ships in
// step with the engine and pins the version that it was built for, so it loads with a check of the
// engine's `VERSION` and throws E1432 when the two differ. `bun run test` runs this over the
// repository.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Packages that are not add-ons: the engine, and the tools that build or serve projects. */
const NOT_ADDONS = new Set(['engine', 'cli', 'vite-plugin']);

/** The constant that an add-on's `version.ts` exports. */
const VERSION_CONSTANT = /export const VERSION = '[^']+';/;

/** The call that stops another engine version, with the add-on's own name. */
const CHECK = /checkAddonVersion\(\s*'([^']+)'\s*,\s*VERSION\s*\)/;

/** Every problem with the add-ons of the repository at `root`, as `path: problem`, and the count of packages read. */
export function addonVersionProblems(root: string): { problems: string[]; packages: number } {
	const problems: string[] = [];
	const folders = readdirSync(join(root, 'packages'))
		.filter(
			(name) => !NOT_ADDONS.has(name) && existsSync(join(root, 'packages', name, 'package.json')),
		)
		.sort();
	for (const folder of folders) {
		const manifest = JSON.parse(
			readFileSync(join(root, 'packages', folder, 'package.json'), 'utf8'),
		) as { name?: string };
		const versionPath = join(root, 'packages', folder, 'src/version.ts');
		if (!existsSync(versionPath)) {
			problems.push(`packages/${folder}/src/version.ts: no version constant`);
			continue;
		}
		if (!VERSION_CONSTANT.test(readFileSync(versionPath, 'utf8')))
			problems.push(`packages/${folder}/src/version.ts: no VERSION constant`);
		const entryPath = join(root, 'packages', folder, 'src/index.ts');
		const entry = existsSync(entryPath) ? readFileSync(entryPath, 'utf8') : '';
		const called = CHECK.exec(entry)?.[1];
		if (called === undefined)
			problems.push(`${relative(root, entryPath)}: loads no checkAddonVersion(name, VERSION) call`);
		else if (manifest.name !== undefined && called !== manifest.name)
			problems.push(
				`${relative(root, entryPath)}: checks itself as "${called}", and its package is ${manifest.name}`,
			);
		if (!/import \{[^}]*checkAddonVersion[^}]*\} from '@null3d\/engine';/.test(entry))
			problems.push(`${relative(root, entryPath)}: imports no checkAddonVersion from the engine`);
	}
	return { problems, packages: folders.length };
}
