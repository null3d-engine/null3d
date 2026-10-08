// Meshopt files from outside the repository's code: the Khronos test file of the sample content,
// whose fallback buffer holds what its meshopt data decodes to, and the test files that gltfpack
// builds from the samples, which the repository keeps.
import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	type MeshoptDecode,
	parseGltf,
	readContainer,
	usesMeshopt,
} from '../../packages/engine/src/scene/gltf-parse.ts';
import { samplePath } from '../../tools/lib/samples.ts';
import { referenceDecoder, shippedDecoder, withRotatedTriangles } from './meshopt-checks.ts';
import { buildFixture, MESHOPT_FIXTURES, MODELS_DIR } from './meshopt-fixtures.ts';

let decode: MeshoptDecode;
let reference: MeshoptDecode;

beforeAll(async () => {
	decode = await shippedDecoder();
	reference = await referenceDecoder();
});

describe('meshopt sample files', () => {
	const url = 'https://example.com/MeshoptCubeTest.gltf';

	test('the Khronos test file decodes as the reference decoder does, and to its fallback buffer', () => {
		const compressed = readContainer(
			readFileSync(samplePath('sources/khronos/MeshoptCubeTest/glTF-Meshopt/MeshoptCubeTest.gltf')),
			url,
		);
		expect(usesMeshopt(compressed)).toBe(true);
		// The loader downloads the buffer of compressed data alone.
		expect([...compressed.external.keys()]).toEqual([0]);
		const bin = new Map([
			[
				0,
				readFileSync(
					samplePath('sources/khronos/MeshoptCubeTest/glTF-Meshopt/MeshoptCubeTest.bin'),
				),
			],
		]);
		const decoded = parseGltf(compressed, bin, url, { meshopt: decode });
		// The file's 35 meshes, and copies of the 5 that its clip turns, which name their joints.
		expect(decoded.meshes).toHaveLength(40);
		expect(decoded).toEqual(parseGltf(compressed, bin, url, { meshopt: reference }));
		// The variant whose fallback buffer holds the decoded bytes, read without the decoder.
		const withFallback = readContainer(
			readFileSync(samplePath('sources/khronos/MeshoptCubeTest/glTF/MeshoptCubeTest.gltf')),
			url,
		);
		expect([...withFallback.external.keys()]).toEqual([0]);
		const buffers = new Map([
			[0, readFileSync(samplePath('sources/khronos/MeshoptCubeTest/glTF/MeshoptCubeTest.bin'))],
			[
				1,
				readFileSync(
					samplePath('sources/khronos/MeshoptCubeTest/glTF/MeshoptCubeTestFallback.bin'),
				),
			],
		]);
		expect(withRotatedTriangles(decoded)).toEqual(
			withRotatedTriangles(parseGltf(withFallback, buffers, url)),
		);
	});

	for (const fixture of MESHOPT_FIXTURES)
		test(`${fixture.file} is what gltfpack builds, and decodes as the reference decoder does`, async () => {
			const committed = readFileSync(join(MODELS_DIR, fixture.file));
			expect(Buffer.from(await buildFixture(fixture)).equals(committed)).toBe(true);
			const container = readContainer(new Uint8Array(committed), url);
			expect(usesMeshopt(container)).toBe(true);
			expect(parseGltf(container, new Map(), url, { meshopt: decode })).toEqual(
				parseGltf(container, new Map(), url, { meshopt: reference }),
			);
		});
});
