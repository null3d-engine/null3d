// The loader's note about a glTF extension that nothing reads prints in a development build and
// prints nothing in a release build. The scenario runs in a Bun process of its own for each build,
// because the development constant is fixed when the engine's modules load.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { UnreadResult } from './unread-extensions-scenario';

/** Runs the scenario with the development checks on or off, and returns its notes. */
function unreadIn(development: boolean): UnreadResult {
	const scenario = join(import.meta.dirname, 'unread-extensions-scenario.ts');
	const code = `const { unreadNotes } = await import(${JSON.stringify(scenario)});
console.log(JSON.stringify(unreadNotes()));`;
	const run = Bun.spawnSync([
		process.execPath,
		'--define',
		`__NULL3D_DEV__=${development}`,
		'-e',
		code,
	]);
	if (run.exitCode !== 0) throw new Error(run.stderr.toString());
	return JSON.parse(run.stdout.toString()) as UnreadResult;
}

describe('a glTF extension that nothing reads', () => {
	test('prints one note for each name in a development build', () => {
		expect(unreadIn(true).notes).toEqual([
			'assets.loadGltf() loaded https://example.com/models/ship.glb, which uses KHR_materials_variants, an extension that the engine does not read, so its data does not draw.',
			'assets.loadGltf() loaded https://example.com/models/ship.glb, which uses KHR_gaussian_splatting, an extension that the engine does not read. Import @null3d/splats, which reads it.',
		]);
	});

	test('prints nothing in a release build', () => {
		expect(unreadIn(false).notes).toEqual([]);
	});
});
