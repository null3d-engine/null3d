// A compressed buffer view that packs many index lists into one block larger than one array may
// be, as glTF-Transform's meshopt writer does with every index list of one width. The block is
// never one GPU buffer, so only the file's total bounds it, and each list read out of it still
// meets the limit of one array. The test holds about half a gibibyte, so it runs in a process of
// its own (tests/lib/heavy-checks.ts).
import { expect, test } from 'bun:test';
import { GltfBuilder } from '../../../../tests/pages/lib/gltf-files';
import { FILE_LIMITS, modelAllowance } from './file-limits';
import { type MeshoptDecode, parseGltf, readContainer } from './gltf-parse';

const URL_OF = 'https://example.com/models/block.glb';
const UNSIGNED_INT = 5125;
const MIB = 1024 * 1024;
/** The lists in the block. */
const LISTS = 9;
/** The indices of each list: 30 MiB of 32-bit indices, whole triangles. */
const PER_LIST = (30 * MIB) / 4;

test('a compressed block of index lists larger than one array may be loads, list by list', () => {
	const blockBytes = LISTS * PER_LIST * 4;
	expect(blockBytes).toBeGreaterThan(FILE_LIMITS.itemBytes);
	expect(PER_LIST * 4).toBeLessThan(FILE_LIMITS.itemBytes);
	// The file pays for the block and for each list's copy. Compressed bytes of that many are what
	// a real writer's file holds for the lists, so its size allows what it decodes to.
	const filler = Math.ceil((2 * blockBytes - FILE_LIMITS.modelFloorBytes) / FILE_LIMITS.modelRatio);
	const b = new GltfBuilder();
	const view = b.meshoptView(new Uint8Array(filler), {
		count: LISTS * PER_LIST,
		byteStride: 4,
		mode: 'TRIANGLES',
	});
	const positions = b.positions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
	const primitives = Array.from({ length: LISTS }, (_, k) => ({
		attributes: { POSITION: positions },
		indices: b.accessorOf(view, UNSIGNED_INT, PER_LIST, 1, { byteOffset: k * PER_LIST * 4 }),
	}));
	b.node({ mesh: b.mesh(primitives) });
	const file = b.glb();
	expect(2 * blockBytes).toBeLessThan(modelAllowance(file.length));

	// The codec's own tests cover the decoding. This decoder writes each list's first triangle, so
	// the test sees that each list reads its own part of the block.
	let decoded = 0;
	const decode: MeshoptDecode = (target, count, stride) => {
		decoded = count * stride;
		const indices = new Uint32Array(target.buffer, target.byteOffset, count);
		for (let k = 0; k < LISTS; k++) indices.set([0, 1, 2], k * PER_LIST);
	};
	const data = parseGltf(readContainer(file, URL_OF), new Map(), URL_OF, { meshopt: decode });
	expect(decoded).toBe(blockBytes);
	const lists = data.meshes[0]?.primitives ?? [];
	expect(lists).toHaveLength(LISTS);
	for (const p of lists) {
		expect(p.indices?.length).toBe(PER_LIST);
		expect(Array.from(p.indices?.subarray(0, 4) ?? [])).toEqual([0, 1, 2, 0]);
	}
});
