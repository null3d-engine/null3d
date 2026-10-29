// A child step of the fresh-project test receives the checkout's built shader modules, so that its
// build compiles none, unless the caller names a folder or asks for the slow path that compiles the
// engine's shaders from source.
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE_SHADERS_ENV } from '../../packages/vite-plugin/src/engine-shaders.ts';
import { engineShaderEnvironment, SHADERS_FROM_SOURCE_ENV } from '../fresh-project.ts';

const MADE: string[] = [];

afterEach(() => {
	for (const folder of MADE.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A temporary folder that holds built modules unless `built` is false. */
function shaderFolder(built = true): string {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-fresh-project-shaders-'));
	MADE.push(folder);
	if (built) writeFileSync(join(folder, 'shaders.ts'), '');
	return folder;
}

describe('engineShaderEnvironment', () => {
	it('leaves a folder that the caller names to the caller', () => {
		const caller = '/a/callers/shader/modules';
		expect(engineShaderEnvironment({ [ENGINE_SHADERS_ENV]: caller }, shaderFolder())).toEqual({});
	});

	it('passes the checkout’s built modules when the folder holds their main module', () => {
		const folder = shaderFolder();
		expect(engineShaderEnvironment({}, folder)).toEqual({ [ENGINE_SHADERS_ENV]: folder });
	});

	it('passes nothing when the checkout holds no built modules', () => {
		expect(engineShaderEnvironment({}, shaderFolder(false))).toEqual({});
	});

	it('passes nothing when the opt-out asks for the modules to be built from source', () => {
		expect(engineShaderEnvironment({ [SHADERS_FROM_SOURCE_ENV]: '1' }, shaderFolder())).toEqual({});
	});
});
