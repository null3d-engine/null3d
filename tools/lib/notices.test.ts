import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixture.ts';
import { NOTICES_PAGE, noticesProblems } from './notices.ts';

const ROOT = join(import.meta.dir, '../..');

/** A package that ships another project's code. */
const PORTED = JSON.stringify({
	name: '@null3d/engine',
	files: ['lib', 'THIRD-PARTY-NOTICES.txt'],
	exports: { '.': './lib/index.js', './package.json': './package.json' },
});

/** A package that ships only its own code. */
const OWN = JSON.stringify({
	name: '@null3d/wind',
	files: ['lib'],
	exports: { '.': './lib/index.js' },
});

const ENGINE_ROW = '| `@null3d/engine` | three.js 0.186.1 | MIT | `THIRD-PARTY-NOTICES.txt` |';
const WIND_ROW = '| `@null3d/wind` | None, its own code | None | None |';

/** A notices page holding the given package rows. */
function page(rows: string[], addons = 'lens-kit'): string {
	return [
		'# Third-party notices',
		'',
		'## Each package',
		'',
		'| Package | Third-party code | License | Notices |',
		'| --- | --- | --- | --- |',
		...rows,
		'',
		'## The example add-ons',
		'',
		`The example add-ons are ${addons}.`,
		'',
	].join('\n');
}

/** The repository files that a passing fixture holds. */
function files(rows: string[], addons?: string): Record<string, string> {
	return {
		'packages/engine/package.json': PORTED,
		'packages/engine/THIRD-PARTY-NOTICES.txt': 'three.js 0.186.1, under the MIT License.',
		'packages/wind/package.json': OWN,
		'examples/addons/lens-kit/index.ts': 'export const lens = 1;',
		[NOTICES_PAGE]: page(rows, addons),
	};
}

describe('noticesProblems', () => {
	test('accepts a package with notices and one with its own code', () => {
		expect(noticesProblems(fixture(files([ENGINE_ROW, WIND_ROW])))).toEqual([]);
	});

	test('refuses a package with no row on the page', () => {
		expect(noticesProblems(fixture(files([ENGINE_ROW]))).join('\n')).toContain(
			'packages/wind: has no row',
		);
	});

	test('refuses a row for a package that does not exist', () => {
		const root = fixture(files([ENGINE_ROW, WIND_ROW, '| `@null3d/water` | None | None | None |']));
		expect(noticesProblems(root).join('\n')).toContain(
			'has a row for water, and packages/water does not exist',
		);
	});

	test('refuses a page that says a ported package ships only its own code', () => {
		const root = fixture(
			files(['| `@null3d/engine` | None, its own code | None | None |', WIND_ROW]),
		);
		expect(noticesProblems(root).join('\n')).toContain(
			'packages/engine: ships THIRD-PARTY-NOTICES.txt, and the page says it ships only its own code',
		);
	});

	test('refuses a row that leaves out the notices file of a ported package', () => {
		const root = fixture(files(['| `@null3d/engine` | three.js 0.186.1 | MIT | None |', WIND_ROW]));
		expect(noticesProblems(root).join('\n')).toContain(
			'packages/engine: the page does not name THIRD-PARTY-NOTICES.txt',
		);
	});

	test('refuses a page that names third-party code for a package with no notices', () => {
		const root = fixture(files([ENGINE_ROW, WIND_ROW]));
		rmSync(join(root, 'packages/engine/THIRD-PARTY-NOTICES.txt'));
		expect(noticesProblems(root).join('\n')).toContain(
			'packages/engine: the page names third-party code, and the package ships no THIRD-PARTY-NOTICES.txt',
		);
	});

	test('refuses a notices file that the tarball would not carry', () => {
		const root = fixture({
			...files([ENGINE_ROW, WIND_ROW]),
			'packages/engine/package.json': JSON.stringify({
				name: '@null3d/engine',
				files: ['lib'],
				exports: { '.': './lib/index.js', './package.json': './package.json' },
			}),
		});
		expect(noticesProblems(root).join('\n')).toContain(
			'package.json files does not list THIRD-PARTY-NOTICES.txt',
		);
	});

	test('refuses a package that cannot be resolved for its notices', () => {
		const root = fixture({
			...files([ENGINE_ROW, WIND_ROW]),
			'packages/engine/package.json': JSON.stringify({
				name: '@null3d/engine',
				files: ['lib', 'THIRD-PARTY-NOTICES.txt'],
				exports: { '.': './lib/index.js' },
			}),
		});
		expect(noticesProblems(root).join('\n')).toContain('exports does not offer ./package.json');
	});

	test('refuses an example add-on that the page leaves out', () => {
		expect(noticesProblems(fixture(files([ENGINE_ROW, WIND_ROW], 'nothing'))).join('\n')).toContain(
			'examples/addons/lens-kit: has no entry',
		);
	});

	test('refuses shipped code that names an upstream its notices leave out', () => {
		const root = fixture({
			...files([ENGINE_ROW, WIND_ROW]),
			'crates/null3d-shaders/wgsl/dof.wgsl': '// It is the gather of KinoBokeh.\n',
		});
		expect(noticesProblems(root).join('\n')).toContain(
			'packages/engine: its shipped code names KinoBokeh, and THIRD-PARTY-NOTICES.txt does not',
		);
	});

	test('accepts shipped code whose notices name its upstream', () => {
		const root = fixture({
			...files([ENGINE_ROW, WIND_ROW]),
			'packages/engine/THIRD-PARTY-NOTICES.txt':
				'three.js 0.186.1 and KinoBokeh, under the MIT License.',
			'crates/null3d-shaders/wgsl/dof.wgsl': '// It is the gather of KinoBokeh.\n',
		});
		expect(noticesProblems(root)).toEqual([]);
	});

	test('refuses an add-on that names an upstream and ships no notices', () => {
		const root = fixture({
			...files([ENGINE_ROW, WIND_ROW]),
			'packages/wind/src/index.ts': '// It follows FidelityFX RCAS.\n',
		});
		expect(noticesProblems(root).join('\n')).toContain(
			'packages/wind: its shipped code names AMD FidelityFX, and the package ships no THIRD-PARTY-NOTICES.txt',
		);
	});

	test('refuses a decision record that claims a port the notices leave out', () => {
		const root = fixture({
			...files([ENGINE_ROW, WIND_ROW]),
			'.dev/decisions/D-999-a-port.md':
				'The depth of field is the gather of KinoBokeh, which the shader ports.\n',
		});
		expect(noticesProblems(root).join('\n')).toContain(
			".dev/decisions/D-999-a-port.md: claims KinoBokeh as a port, and the engine's THIRD-PARTY-NOTICES.txt does not name it",
		);
	});

	test('accepts a decision record whose claimed port the engine notices name', () => {
		const root = fixture({
			...files([ENGINE_ROW, WIND_ROW]),
			'packages/engine/THIRD-PARTY-NOTICES.txt':
				'three.js 0.186.1 and KinoBokeh, under the MIT License.',
			'.dev/decisions/D-999-a-port.md':
				'The depth of field is the gather of KinoBokeh, which the shader ports.\n',
		});
		expect(noticesProblems(root)).toEqual([]);
	});
});

describe('the repository', () => {
	test('gives every package and example add-on an entry that its files match', () => {
		expect(noticesProblems(ROOT)).toEqual([]);
	});
});
