import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { addonVersionProblems } from './addon-versions.ts';
import { fixture } from './fixture.ts';

/** A package manifest for an add-on of `name`. */
const manifestOf = (name: string) => `{ "name": "${name}" }`;

/** A version constant, as the release writes it. */
const VERSION_CONSTANT = "export const VERSION = '0.0.0';\n";

/**
 * An add-on's entry point, which imports the check and calls it with the package's own name. A
 * problem under test leaves out the import, leaves out the call, or calls another name.
 */
function entry(
	name: string,
	{ importCheck = true, call = `checkAddonVersion('${name}', VERSION);` } = {},
) {
	const imported = importCheck ? "import { checkAddonVersion } from '@null3d/engine';\n" : '';
	return `${imported}import { VERSION } from './version';\n\n${call}\n`;
}

/** The files of an add-on package in `folder`, with its entry point. */
function addon(folder: string, index: string): Record<string, string> {
	return {
		[`packages/${folder}/package.json`]: manifestOf(`@null3d/${folder}`),
		[`packages/${folder}/src/version.ts`]: VERSION_CONSTANT,
		[`packages/${folder}/src/index.ts`]: index,
	};
}

describe('addonVersionProblems', () => {
	test('passes an add-on that checks its version as it loads', () => {
		const root = fixture({
			'packages/engine/package.json': manifestOf('@null3d/engine'),
			...addon('checked', entry('@null3d/checked')),
		});
		expect(addonVersionProblems(root)).toEqual({ problems: [], packages: 1 });
	});

	test('names a package without a version constant, or with no constant in it', () => {
		const root = fixture({
			'packages/noversion/package.json': manifestOf('@null3d/noversion'),
			'packages/noversion/src/index.ts': entry('@null3d/noversion'),
			'packages/empty/package.json': manifestOf('@null3d/empty'),
			'packages/empty/src/version.ts': 'export const VERSION = someVersion;\n',
			'packages/empty/src/index.ts': entry('@null3d/empty'),
		});
		expect(addonVersionProblems(root).problems).toEqual([
			'packages/empty/src/version.ts: no VERSION constant',
			'packages/noversion/src/version.ts: no version constant',
		]);
	});

	test('names an add-on that never calls the check, one that names another package, and one that imports nothing', () => {
		const root = fixture({
			...addon('silent', entry('@null3d/silent', { call: '' })),
			...addon(
				'wrong',
				entry('@null3d/wrong', { call: "checkAddonVersion('@null3d/other', VERSION);" }),
			),
			...addon('nocheck', entry('@null3d/nocheck', { importCheck: false })),
		});
		expect(addonVersionProblems(root).problems).toEqual([
			'packages/nocheck/src/index.ts: imports no checkAddonVersion from the engine',
			'packages/silent/src/index.ts: loads no checkAddonVersion(name, VERSION) call',
			'packages/wrong/src/index.ts: checks itself as "@null3d/other", and its package is @null3d/wrong',
		]);
	});

	test('reads every add-on of this repository, and each one checks its version', () => {
		const root = join(import.meta.dirname, '..', '..');
		const { problems, packages } = addonVersionProblems(root);
		expect(problems).toEqual([]);
		expect(packages).toBeGreaterThanOrEqual(5);
	});
});
