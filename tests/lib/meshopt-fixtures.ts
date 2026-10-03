// The meshopt test files that the repository keeps, and the step that builds them. No Khronos
// sample model under an accepted licence uses the EXT_meshopt_compression name, so gltfpack, the
// meshoptimizer project's own tool, compresses one: SimpleInstancing (CC0), from the pinned sample
// content. The file uses the attribute and triangle modes and the octahedral, exponential and
// quaternion filters. The Khronos name, KHR_meshopt_compression, comes with the sample content's
// MeshoptCubeTest, which also covers the index mode, the color filter and the newer vertex codec.
//
// gltfpack is a single-threaded WebAssembly build, so it writes the same bytes on every machine.
// `bun tests/lib/meshopt-fixtures.ts` writes the files again, and a unit test checks that the
// committed files match what the step builds.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pack } from 'gltfpack';
import { samplePath } from '../../tools/lib/samples.ts';

/** The folder of the test models, beside the test pages that load them. */
export const MODELS_DIR = join(import.meta.dirname, '../pages/assets/models');

/** A meshopt test file: its name, the sample it compresses and gltfpack's options. */
export interface MeshoptFixture {
	file: string;
	/** The sample file's path in the cache. */
	source: () => string;
	options: readonly string[];
}

/**
 * The test files. `-cc` compresses with meshopt's filters, and `-ce ext` uses the vendor
 * extension's name.
 */
export const MESHOPT_FIXTURES: readonly MeshoptFixture[] = [
	{
		file: 'simple-instancing-meshopt.glb',
		source: () => samplePath('sources/khronos/SimpleInstancing/glTF-Binary/SimpleInstancing.glb'),
		options: ['-cc', '-ce', 'ext'],
	},
];

/** Builds one test file with gltfpack, in memory. */
export async function buildFixture(fixture: MeshoptFixture): Promise<Uint8Array> {
	let output: Uint8Array | undefined;
	await pack(['-i', 'in.glb', '-o', 'out.glb', ...fixture.options], {
		read: (path) => {
			if (path !== 'in.glb') throw new Error(`gltfpack asked for ${path}`);
			return readFileSync(fixture.source());
		},
		write: (path, data) => {
			if (path === 'out.glb') output = data.slice();
		},
	});
	if (!output) throw new Error(`gltfpack wrote no ${fixture.file}`);
	return output;
}

if (import.meta.main) {
	for (const fixture of MESHOPT_FIXTURES) {
		const bytes = await buildFixture(fixture);
		writeFileSync(join(MODELS_DIR, fixture.file), bytes);
		console.log(`wrote ${fixture.file}: ${bytes.length} bytes`);
	}
}
