import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { addonLayoutProblems } from './addon-layout.ts';
import { fixture } from './fixture.ts';

const README = `# Lanes

## Licence

MIT OR Apache-2.0, the engine's licences.
`;

describe('addonLayoutProblems', () => {
	test('accepts an add-on with an entry, its shader and its declaration, and a README with its licence', () => {
		const root = fixture({
			'examples/addons/lanes/index.ts': "import shader from './vehicle.wgsl';",
			'examples/addons/lanes/vehicle.wgsl': '',
			'examples/addons/lanes/vehicle.wgsl.d.ts': '',
			'examples/addons/lanes/README.md': README,
		});
		try {
			expect(addonLayoutProblems(root)).toEqual({ problems: [], folders: ['lanes'] });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('reports each missing part of the shape', () => {
		const root = fixture({
			'examples/addons/bare/index.ts': 'export const nothing = 1;',
			'examples/addons/bare/README.md': '# Bare\n',
			'examples/addons/no-entry/vehicle.wgsl': '',
			'examples/addons/no-entry/vehicle.wgsl.d.ts': '',
			'examples/addons/no-entry/README.md': README,
		});
		try {
			expect(addonLayoutProblems(root).problems).toEqual([
				'bare: no .wgsl shader',
				'bare: README.md has no "## Licence" section',
				'bare: README.md does not name MIT OR Apache-2.0',
				'no-entry: no index.ts entry',
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('reports a shader without its declaration and one that the entry never imports', () => {
		const root = fixture({
			'examples/addons/lanes/index.ts': "import shader from './other.wgsl';",
			'examples/addons/lanes/vehicle.wgsl': '',
			'examples/addons/lanes/other.wgsl': '',
			'examples/addons/lanes/other.wgsl.d.ts': '',
			'examples/addons/lanes/README.md': README,
		});
		try {
			expect(addonLayoutProblems(root).problems).toEqual([
				'lanes: vehicle.wgsl has no vehicle.wgsl.d.ts beside it',
				'lanes: index.ts does not import vehicle.wgsl',
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('the repository', () => {
	test('every example add-on follows the shared layout', () => {
		const { problems, folders } = addonLayoutProblems(join(import.meta.dir, '../..'));
		expect(problems).toEqual([]);
		expect(folders).toEqual(expect.arrayContaining(['lens-kit', 'traffic-lanes']));
	});
});
