// The small Draco test file that the repository keeps, and the step that builds it. The Khronos
// sample content holds one Draco model, RiggedSimple, which has no texture coordinates. So Draco's
// own encoder compresses TextureCoordinateTest (CC0), from the pinned sample content, through
// glTF-Transform, with its default settings, the way most tools write Draco files: five quads with
// normals and texture coordinates, whose image tests compare it with its uncompressed scene.
//
// The encoder is a single-threaded WebAssembly build, so it writes the same bytes on every machine.
// `bun tests/lib/draco-fixtures.ts` writes the file again, and a unit test checks that the
// committed file matches what the step builds. The asset tool's package holds both libraries.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { samplePath } from '../../tools/lib/samples.ts';
import { MODELS_DIR } from './meshopt-fixtures.ts';

/** The test file's name in the folder of the test models. */
export const DRACO_FIXTURE = 'texture-coordinates-draco.glb';

const cli = createRequire(join(import.meta.dirname, '../../packages/cli/package.json'));

/** Builds the test file with Draco's encoder, in memory. */
export async function buildDracoFixture(): Promise<Uint8Array> {
	const { NodeIO } = cli('@gltf-transform/core');
	const { ALL_EXTENSIONS, KHRDracoMeshCompression } = cli('@gltf-transform/extensions');
	const draco3d = cli('draco3d');
	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
		'draco3d.encoder': await draco3d.createEncoderModule(),
		'draco3d.decoder': await draco3d.createDecoderModule(),
	});
	const doc = await io.readBinary(
		readFileSync(
			samplePath('sources/khronos/TextureCoordinateTest/glTF-Binary/TextureCoordinateTest.glb'),
		),
	);
	doc.createExtension(KHRDracoMeshCompression).setRequired(true);
	return io.writeBinary(doc);
}

if (import.meta.main) {
	const bytes = await buildDracoFixture();
	writeFileSync(join(MODELS_DIR, DRACO_FIXTURE), bytes);
	console.log(`wrote ${DRACO_FIXTURE}: ${bytes.length} bytes`);
}
