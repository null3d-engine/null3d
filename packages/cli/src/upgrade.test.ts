import { describe, expect, it, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../../../tools/lib/fixture';
import { UsageError } from './args.js';
import {
	MANIFEST,
	parseUpgradeArgs,
	rewrittenManifest,
	run,
	targetVersion,
	upgradeChanges,
	upgradeProject,
} from './upgrade.js';
import { VERSION } from './version.js';

/** A project whose manifest names null3D packages at one version, indented by two spaces. */
const PROJECT = `{
  "name": "harbor",
  "dependencies": {
    "@null3d/engine": "0.1.0",
    "@null3d/controls": "^0.1.0",
    "three": "0.186.1"
  },
  "devDependencies": {
    "@null3d/terrain": "0.1.0",
    "@null3d/engine": "0.1.0"
  }
}
`;

/** What parsing `args` throws, as the message a person sees. */
function mistake(args: string[]): string {
	try {
		parseUpgradeArgs(args);
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as Error).message;
	}
	throw new Error(`${args.join(' ')} parsed without a mistake`);
}

describe('parseUpgradeArgs', () => {
	it('reads no version and no dry run by default', () => {
		expect(parseUpgradeArgs([])).toEqual({ dryRun: false, help: false });
	});

	it('reads the version to move to, and the dry run', () => {
		expect(parseUpgradeArgs(['--to', '0.2.0', '--dry-run'])).toEqual({
			to: '0.2.0',
			dryRun: true,
			help: false,
		});
		expect(parseUpgradeArgs(['--to=1.0.0-rc.1']).to).toBe('1.0.0-rc.1');
	});

	it('refuses a version that is not one', () => {
		expect(mistake(['--to', 'latest'])).toBe('--to takes a version such as 0.2.0, not "latest"');
		expect(mistake(['--to', '^0.2.0'])).toContain('--to takes a version');
	});
});

describe('upgradeChanges', () => {
	it('moves every package that names a version, in every section', () => {
		const manifest = {
			dependencies: { '@null3d/engine': '0.1.0', '@null3d/controls': '^0.1.0', three: '0.186.1' },
			devDependencies: { '@null3d/terrain': '0.1.0' },
			peerDependencies: { '@null3d/engine': '>=0.1.0' },
			optionalDependencies: { '@null3d/particles': '0.0.9' },
			overrides: { '@null3d/engine': '0.1.0' },
		};
		expect(upgradeChanges(manifest, '0.2.0')).toEqual([
			{ section: 'dependencies', name: '@null3d/engine', from: '0.1.0', to: '0.2.0' },
			{ section: 'dependencies', name: '@null3d/controls', from: '^0.1.0', to: '0.2.0' },
			{ section: 'devDependencies', name: '@null3d/terrain', from: '0.1.0', to: '0.2.0' },
			{ section: 'peerDependencies', name: '@null3d/engine', from: '>=0.1.0', to: '0.2.0' },
			{
				section: 'optionalDependencies',
				name: '@null3d/particles',
				from: '0.0.9',
				to: '0.2.0',
			},
			{ section: 'overrides', name: '@null3d/engine', from: '0.1.0', to: '0.2.0' },
		]);
	});

	it('leaves alone a package that is at the version, and one that names a file or a workspace', () => {
		const manifest = {
			dependencies: {
				'@null3d/engine': 'file:../engine.tgz',
				'@null3d/controls': 'workspace:*',
				'@null3d/terrain': 'git+https://example.com/terrain.git',
				'@null3d/particles': '0.2.0',
			},
		};
		expect(upgradeChanges(manifest, '0.2.0')).toEqual([]);
	});

	it('reads no section that is not an object of names', () => {
		expect(upgradeChanges({ dependencies: 'none' }, '0.2.0')).toEqual([]);
		expect(upgradeChanges({ dependencies: ['@null3d/engine'] }, '0.2.0')).toEqual([]);
	});
});

describe('targetVersion', () => {
	it('takes the version that the command names, before any other', () => {
		const root = fixture({
			[`node_modules/@null3d/engine/${MANIFEST}`]: '{ "version": "0.1.0" }',
		});
		expect(targetVersion(root, '0.2.0')).toBe('0.2.0');
	});

	it('takes the installed engine version, and the tool version without an engine', () => {
		const root = fixture({
			[`node_modules/@null3d/engine/${MANIFEST}`]: '{ "version": "0.1.0" }',
		});
		expect(targetVersion(root, undefined)).toBe('0.1.0');
		expect(targetVersion(fixture({}), undefined)).toBe(VERSION);
	});
});

describe('rewrittenManifest', () => {
	it('keeps the indentation and the closing newline of the file', () => {
		const manifest = { name: 'harbor', dependencies: { '@null3d/engine': '0.2.0' } };
		expect(rewrittenManifest(PROJECT, manifest)).toBe(`${JSON.stringify(manifest, null, '  ')}\n`);
		expect(rewrittenManifest('{\n\t"name": "harbor"\n}\n', manifest)).toBe(
			`${JSON.stringify(manifest, null, '\t')}\n`,
		);
		expect(rewrittenManifest('{"name":"harbor"}', manifest).endsWith('\n')).toBe(false);
	});
});

describe('upgradeProject', () => {
	it('writes the version into every null3D package, and reports each change', () => {
		const root = fixture({ [MANIFEST]: PROJECT });
		const result = upgradeProject(root, { to: '0.2.0', dryRun: false });
		expect(result.code).toBe(0);
		expect(result.lines).toEqual([
			'@null3d/engine: 0.1.0 -> 0.2.0 (dependencies)',
			'@null3d/controls: ^0.1.0 -> 0.2.0 (dependencies)',
			'@null3d/terrain: 0.1.0 -> 0.2.0 (devDependencies)',
			'@null3d/engine: 0.1.0 -> 0.2.0 (devDependencies)',
			'Moved 4 packages to 0.2.0. Run bun install to install them.',
		]);
		const manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
		expect(manifest.dependencies).toEqual({
			'@null3d/engine': '0.2.0',
			'@null3d/controls': '0.2.0',
			three: '0.186.1',
		});
		expect(manifest.devDependencies['@null3d/terrain']).toBe('0.2.0');
		expect(readFileSync(join(root, MANIFEST), 'utf8').endsWith('}\n')).toBe(true);
	});

	it('takes the version from the installed engine', () => {
		const root = fixture({
			[MANIFEST]: PROJECT,
			[`node_modules/@null3d/engine/${MANIFEST}`]: '{ "version": "0.1.5" }',
		});
		expect(upgradeProject(root, { dryRun: false }).lines.at(-1)).toBe(
			'Moved 4 packages to 0.1.5. Run bun install to install them.',
		);
	});

	it('writes nothing with --dry-run', () => {
		const root = fixture({ [MANIFEST]: PROJECT });
		const result = upgradeProject(root, { to: '0.2.0', dryRun: true });
		expect(result.code).toBe(0);
		expect(result.lines.at(-1)).toBe(
			'Would move 4 packages to 0.2.0. Run it without --dry-run to write package.json.',
		);
		expect(readFileSync(join(root, MANIFEST), 'utf8')).toBe(PROJECT);
	});

	it('says when every package is at the version already', () => {
		const root = fixture({
			[MANIFEST]: '{ "dependencies": { "@null3d/engine": "0.2.0" } }\n',
		});
		expect(upgradeProject(root, { to: '0.2.0', dryRun: false })).toEqual({
			code: 0,
			lines: ['Every null3D package is at 0.2.0 already.'],
		});
	});

	it('says when the manifest names no null3D package', () => {
		const root = fixture({ [MANIFEST]: '{ "dependencies": { "three": "0.186.1" } }\n' });
		expect(upgradeProject(root, { dryRun: false })).toEqual({
			code: 0,
			lines: ['package.json names no null3D package.'],
		});
	});

	it('fails on a folder without a manifest, and on one that is not JSON', () => {
		const empty = fixture({});
		const missing = upgradeProject(empty, { dryRun: false });
		expect(missing.code).toBe(1);
		expect(missing.lines[0]).toContain(`has no ${MANIFEST}`);
		const broken = fixture({ [MANIFEST]: '{ "dependencies": ' });
		const result = upgradeProject(broken, { dryRun: false });
		expect(result.code).toBe(1);
		expect(result.lines[0]).toStartWith(`${MANIFEST} is not valid JSON:`);
		const list = fixture({ [MANIFEST]: '["@null3d/engine"]\n' });
		expect(upgradeProject(list, { dryRun: false })).toEqual({
			code: 1,
			lines: [`${MANIFEST} does not hold an object.`],
		});
	});

	it('leaves a manifest whose packages name a file as it is, and says why', () => {
		const text = '{ "dependencies": { "@null3d/engine": "file:../engine.tgz" } }\n';
		const root = fixture({ [MANIFEST]: text });
		expect(upgradeProject(root, { to: '0.2.0', dryRun: false }).lines).toEqual([
			'Every null3D package names a file, a link or a workspace, so there is no version to change.',
		]);
		expect(readFileSync(join(root, MANIFEST), 'utf8')).toBe(text);
	});
});

describe('run', () => {
	it('prints its help', async () => {
		const log = spyOn(console, 'log').mockImplementation(() => {});
		try {
			expect(await run(['--help'])).toBe(0);
			expect(log.mock.lastCall?.[0]).toStartWith('Usage: bunx @null3d/cli upgrade [options]');
		} finally {
			log.mockRestore();
		}
	});
});
