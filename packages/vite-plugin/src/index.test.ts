import { describe, expect, it } from 'bun:test';
import { fixture } from '../../../tools/lib/fixture';
import { CORE_FILES, missingCoreFiles } from './index';

/** A project with the engine package installed, holding the given core files. */
function project(files: readonly string[]): string {
	const engine = 'node_modules/@null3d/engine';
	return fixture({
		'package.json': '{"name":"game","private":true}',
		[`${engine}/package.json`]: JSON.stringify({
			name: '@null3d/engine',
			exports: { '.': './index.js', './wasm/*': './dist/wasm/*' },
		}),
		[`${engine}/index.js`]: '',
		...Object.fromEntries(files.map((file) => [`${engine}/dist/wasm/${file}`, 'x'])),
	});
}

describe('missingCoreFiles', () => {
	it('is null when the project does not install the engine', () => {
		expect(missingCoreFiles(fixture({ 'package.json': '{}' }))).toBeNull();
	});

	it('lists each core file the engine package lacks', () => {
		expect(missingCoreFiles(project([]))).toEqual([...CORE_FILES]);
		expect(missingCoreFiles(project(CORE_FILES.slice(1)))).toEqual(CORE_FILES.slice(0, 1));
		expect(missingCoreFiles(project(CORE_FILES))).toEqual([]);
	});
});
