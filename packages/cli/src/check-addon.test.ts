import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../../../tools/lib/fixture';
import { LATER_BUDGET } from '../../../tools/lib/size-report.ts';
import { UsageError } from './args.js';
import {
	ADDON_FILE_BUDGET,
	engineVersions,
	interfaceResult,
	pageOf,
	parseCheckAddonArgs,
	publicApiProblems,
	readAddon,
	run,
	sizeProblems,
} from './check-addon.js';

/** The engine that these tests declare an add-on against. */
const ENGINE = { version: '0.3.0', pluginInterface: 2 };

/** What parsing `args` throws, as the message a person sees. */
function mistake(args: string[]): string {
	try {
		parseCheckAddonArgs(args);
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as Error).message;
	}
	throw new Error(`${args.join(' ')} parsed without a mistake`);
}

describe('parseCheckAddonArgs', () => {
	it('checks the current folder, with no page and the browser gates on', () => {
		expect(parseCheckAddonArgs([])).toEqual({
			folder: process.cwd(),
			page: undefined,
			skipBrowser: false,
			help: false,
		});
	});

	it('reads the folder, the page and the browser switch', () => {
		expect(
			parseCheckAddonArgs(['addons/splats', '--page', '/demo.html', '--skip-browser']),
		).toEqual({
			folder: 'addons/splats',
			page: '/demo.html',
			skipBrowser: true,
			help: false,
		});
	});

	it('refuses two folders, naming the second', () => {
		expect(mistake(['one', 'two'])).toBe('it checks one folder, not "two"');
	});

	it("refuses a page that is not a path from the project's root", () => {
		expect(mistake(['--page', 'demo.html'])).toBe(
			'--page takes a path from the project\'s root that starts with /, such as /demo.html, not "demo.html"',
		);
	});
});

describe('readAddon', () => {
	it('reads the name and the source entry of a package', () => {
		const folder = fixture({
			'package.json': JSON.stringify({
				name: '@acme/splats',
				exports: { '.': { 'null3d-source': './src/main.ts', default: './lib/main.js' } },
			}),
			'src/main.ts': 'export const splats = 1;\n',
		});
		expect(readAddon(folder)).toEqual({
			name: '@acme/splats',
			entry: join(folder, 'src/main.ts'),
			problems: [],
		});
	});

	it('falls back to module, main and src/index.ts', () => {
		const withModule = fixture({ 'package.json': '{"name":"a","module":"./m.js"}', 'm.js': '' });
		expect(readAddon(withModule).entry).toBe(join(withModule, 'm.js'));
		const withMain = fixture({ 'package.json': '{"name":"b","main":"./m.mjs"}', 'm.mjs': '' });
		expect(readAddon(withMain).entry).toBe(join(withMain, 'm.mjs'));
		const withIndex = fixture({ 'package.json': '{"name":"c"}', 'src/index.ts': '' });
		expect(readAddon(withIndex).entry).toBe(join(withIndex, 'src/index.ts'));
	});

	it('names what is missing', () => {
		expect(readAddon(fixture({})).problems).toEqual(['package.json does not exist in this folder']);
		expect(readAddon(fixture({ 'package.json': '{' })).problems[0] ?? '').toStartWith(
			'package.json is not JSON: ',
		);
		expect(readAddon(fixture({ 'package.json': '[]' })).problems).toEqual([
			'package.json is not an object',
		]);
		expect(readAddon(fixture({ 'package.json': '{}' })).problems).toEqual([
			'package.json names no package in its "name" field',
		]);
		expect(readAddon(fixture({ 'package.json': '{"name":"a"}' })).problems[0] ?? '').toStartWith(
			'no entry file: ',
		);
	});
});

describe('publicApiProblems', () => {
	it('accepts the public entry points and other packages', () => {
		const folder = fixture({
			'src/index.ts': [
				"import { defineSketch } from '@null3d/engine';",
				"import type { FrameStats } from '@null3d/engine/stats';",
				"import * as three from 'three';",
				"export * from './shapes.js';",
				'',
			].join('\n'),
			'src/shapes.ts': "export const shapes = await import('./more.js');\n",
			'src/more.ts': "export const more = require('some-package');\n",
		});
		expect(publicApiProblems(folder)).toEqual({ problems: [], files: 3 });
	});

	it('refuses an add-on that imports the engine internal entry, and names the file', () => {
		const folder = fixture({
			'src/index.ts':
				"import { internals } from '@null3d/engine/internal';\nexport { internals };\n",
		});
		expect(publicApiProblems(folder)).toEqual({
			problems: ['src/index.ts imports @null3d/engine/internal, which is not a public entry point'],
			files: 1,
		});
	});

	it('refuses every other engine sub-path too', () => {
		const folder = fixture({
			'src/index.ts': "export { x } from '@null3d/engine/scene';\n",
		});
		expect(publicApiProblems(folder).problems).toEqual([
			'src/index.ts imports @null3d/engine/scene, which is not a public entry point',
		]);
	});

	it('does not read test files or declarations', () => {
		const folder = fixture({
			'src/index.ts': 'export const ok = 1;\n',
			'src/index.test.ts': "import '@null3d/engine/internal';\n",
			'src/types.d.ts': "import '@null3d/engine/internal';\n",
		});
		expect(publicApiProblems(folder)).toEqual({ problems: [], files: 1 });
	});
});

describe('interfaceResult', () => {
	const folder = fixture({});
	const entry = (text: string) => {
		const path = join(folder, 'index.ts');
		writeFileSync(path, text);
		return path;
	};

	it('accepts a range that holds the engine interface', () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry("checkPluginInterface('@acme/splats', { min: 1, max: 3 });"),
				ENGINE,
			),
		).toEqual({ text: 'declares plugin interface 1 to 3, and this engine has 2' });
	});

	it('accepts a single-version range that holds the engine interface', () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry("checkPluginInterface('@acme/splats', { min: 2, max: 2 });"),
				ENGINE,
			),
		).toEqual({ text: 'declares plugin interface 2, and this engine has 2' });
	});

	it('accepts the interface version constant in place of a number', () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry(
					"import { PLUGIN_INTERFACE_VERSION } from '@null3d/engine';\ncheckPluginInterface('@acme/splats', { min: PLUGIN_INTERFACE_VERSION, max: PLUGIN_INTERFACE_VERSION });",
				),
				ENGINE,
			),
		).toEqual({ text: 'declares plugin interface 2, and this engine has 2' });
	});

	it('refuses a range that ends before the engine interface, naming both', () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry("checkPluginInterface('@acme/splats', { min: 1, max: 1 });"),
				ENGINE,
			),
		).toEqual({
			problem: 'was built for plugin interface 1, and this engine has 2',
			text: '',
		});
	});

	it('refuses a range that starts after the engine interface, naming both', () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry("checkPluginInterface('@acme/splats', { min: 3, max: 4 });"),
				ENGINE,
			),
		).toEqual({
			problem: 'was built for plugin interface 3 to 4, and this engine has 2',
			text: '',
		});
	});

	it('refuses a declaration under another name', () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry("checkPluginInterface('@acme/hair', { min: 2, max: 2 });"),
				ENGINE,
			),
		).toEqual({
			problem: 'checks itself as "@acme/hair", and its package is @acme/splats',
			text: '',
		});
	});

	it('refuses an add-on with no declaration, and says what to call', () => {
		expect(interfaceResult('@acme/splats', entry('export const x = 1;'), ENGINE).problem).toBe(
			"declares no plugin interface range: call checkPluginInterface('@acme/splats', { min, max }), or add pluginInterface: { min, max } to declareAddonNamespace(), as the module loads",
		);
	});

	it('accepts the range in the add-on namespace registration', () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry(
					"declareAddonNamespace({\n\tname: '@acme/splats',\n\tpluginInterface: { min: 1, max: 3 },\n\tshaderLibrary: 'splats',\n});",
				),
				ENGINE,
			),
		).toEqual({ text: 'declares plugin interface 1 to 3, and this engine has 2' });
	});

	it('refuses a namespace range that leaves out the engine, naming both', () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry(
					"declareAddonNamespace({\n\tname: '@acme/splats',\n\tpluginInterface: { min: 3, max: 4 },\n});",
				),
				ENGINE,
			),
		).toEqual({
			problem: 'was built for plugin interface 3 to 4, and this engine has 2',
			text: '',
		});
	});

	it('refuses a namespace that declares no range', () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry("declareAddonNamespace({ name: '@acme/splats', shaderLibrary: 'splats' });"),
				ENGINE,
			).problem,
		).toBe(
			"declares no plugin interface range: call checkPluginInterface('@acme/splats', { min, max }), or add pluginInterface: { min, max } to declareAddonNamespace(), as the module loads",
		);
	});

	it("accepts a namespace name, which is the add-on's own short name, not its package name", () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry("declareAddonNamespace({ name: 'splats', pluginInterface: { min: 2, max: 2 } });"),
				ENGINE,
			),
		).toEqual({ text: 'declares plugin interface 2, and this engine has 2' });
	});

	it('refuses a declaration that is no range of whole versions', () => {
		expect(
			interfaceResult(
				'@acme/splats',
				entry("checkPluginInterface('@acme/splats', { min: 3, max: 1 });"),
				ENGINE,
			).problem,
		).toBe('declares plugin interface versions 3 to 1, which is no range');
	});

	it('accepts an engine add-on that pins the engine version', () => {
		expect(
			interfaceResult(
				'@null3d/particles',
				entry("checkAddonVersion('@null3d/particles', VERSION);"),
				ENGINE,
			),
		).toEqual({ text: 'pins null3D 0.3.0' });
	});

	it('refuses an engine add-on with no version pin', () => {
		expect(interfaceResult('@null3d/particles', entry('export const x = 1;'), ENGINE).problem).toBe(
			'declares no engine version: call checkAddonVersion(name, VERSION) as the module loads',
		);
	});
});

describe('pageOf', () => {
	it('takes the page that the caller names', () => {
		expect(pageOf(fixture({}), '/demo.html')).toEqual({ page: '/demo.html' });
	});

	it("takes the page of the project config's first test", () => {
		const folder = fixture({
			'null3d.json': JSON.stringify({ tests: [{ name: 'demo', page: '/demo.html', hold: 1 }] }),
			'demo.html': '',
		});
		expect(pageOf(folder, undefined)).toEqual({ page: '/demo.html' });
	});

	it('gives the reason when there is no page', () => {
		expect(pageOf(fixture({}), undefined).reason).toBe(
			'the folder has no null3d.json, and --page names no page',
		);
		const onlySketch = fixture({
			'null3d.json': JSON.stringify({ tests: [{ name: 'start', sketch: 'sketch.ts', hold: 1 }] }),
			'sketch.ts': '',
		});
		expect(pageOf(onlySketch, undefined).reason).toBe(
			'the first test in null3d.json names no page, and --page names none',
		);
		const broken = fixture({ 'null3d.json': '{"tests": 3}' });
		expect(pageOf(broken, undefined).reason ?? '').toStartWith('null3d.json has a problem: ');
	});
});

describe('engineVersions', () => {
	it("reads this repository's engine version and plugin interface version", () => {
		expect(engineVersions(join(import.meta.dirname, '../../../packages/particles'))).toEqual({
			version: '0.0.0',
			pluginInterface: 1,
		});
	});

	it('gives nothing when no engine sits beside the add-on', () => {
		expect(engineVersions(fixture({ 'package.json': '{"name":"@acme/splats"}' }))).toBeUndefined();
	});
});

describe('the add-on budgets', () => {
	it("hold to the engine's budget for a file that loads after the start", () => {
		expect(ADDON_FILE_BUDGET).toEqual(LATER_BUDGET);
	});
});

describe('sizeProblems', () => {
	const KB = 1024;

	it('accepts a file at its budget in every column', () => {
		expect(
			sizeProblems([{ name: 'addon.js', raw: 64 * KB, gzip: 24 * KB, brotli: 17 * KB }]),
		).toEqual([]);
	});

	it('names each column of a file over its budget', () => {
		expect(
			sizeProblems([{ name: 'addon.js', raw: 65 * KB, gzip: 25 * KB, brotli: 18 * KB }]),
		).toEqual([
			'addon.js is 65.0 KB raw, over its 64.0 KB budget',
			'addon.js is 25.0 KB gzip, over its 24.0 KB budget',
			'addon.js is 18.0 KB brotli, over its 17.0 KB budget',
		]);
	});

	it('checks every file that the build wrote', () => {
		expect(
			sizeProblems([
				{ name: 'small.js', raw: KB, gzip: KB, brotli: KB },
				{ name: 'large.js', raw: 65 * KB, gzip: KB, brotli: KB },
			]),
		).toEqual(['large.js is 65.0 KB raw, over its 64.0 KB budget']);
	});
});

describe('run', () => {
	const log = spyOn(console, 'log').mockImplementation(() => {});
	afterEach(() => log.mockClear());

	/** What the command printed, as lines. */
	const printed = () => log.mock.calls.map((call) => String(call[0])).join('\n');

	it('fails on a folder that holds no package', async () => {
		expect(await run([fixture({})])).toBe(1);
		expect(printed()).toStartWith('FAIL  package: package.json does not exist in this folder');
	});

	it('fails on a package with no entry file', async () => {
		expect(await run([fixture({ 'package.json': '{"name":"@acme/splats"}' })])).toBe(1);
		expect(printed()).toStartWith('FAIL  package: no entry file: ');
	});

	it('fails on an add-on that imports the engine internal entry', async () => {
		const folder = fixture({
			'package.json': JSON.stringify({ name: '@acme/broken' }),
			'src/index.ts':
				"import { internals } from '@null3d/engine/internal';\nexport { internals };\n",
		});
		expect(await run([folder])).toBe(1);
		expect(printed()).toContain('FAIL  public API: 1 import reaches past the engine');
		expect(printed()).toContain(
			'      src/index.ts imports @null3d/engine/internal, which is not a public entry point',
		);
	});

	it('passes an add-on that imports only the public entry points', async () => {
		const folder = fixture({
			'package.json': JSON.stringify({ name: '@acme/splats' }),
			'src/index.ts': "import { vec3 } from '@null3d/engine';\nexport { vec3 };\n",
		});
		expect(await run([folder])).toBe(0);
		expect(printed()).toContain('PASS  public API: 1 file imports only the engine');
	});

	it('prints the help without checking anything', async () => {
		expect(await run(['--help'])).toBe(0);
		expect(printed()).toStartWith('Usage: bunx @null3d/cli check-addon [folder] [options]');
	});
});
