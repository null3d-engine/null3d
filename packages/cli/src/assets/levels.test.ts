import { describe, expect, it } from 'bun:test';
import { Document, type Node, type Primitive } from '@gltf-transform/core';
import { planLevels, storeLevels } from './levels.js';
import { lodOf } from './lod-extension.js';

/** The most cards a mesh of trees has in the test, and each card's side. */
const CARDS = 40;
const CARD = 0.1;

/**
 * A document whose tree mesh holds a list of separate cards, as leaves are, and a list of wood
 * that simplifies the usual way.
 */
function treeDocument() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const material = doc.createMaterial('leaves');
	const mesh = doc.createMesh('tree');
	const positions: number[] = [];
	const indices: number[] = [];
	for (let k = 0; k < CARDS; k++) {
		// A square card, each at its own place in a cube of 3 m, turned its own way.
		const at = [k % 5, Math.floor(k / 5) % 4, Math.floor(k / 20)];
		const first = positions.length / 3;
		for (const [u, v] of [
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1],
		])
			positions.push(
				(at[0] as number) + (u as number) * CARD,
				(at[1] as number) + (v as number) * CARD,
				at[2] as number,
			);
		indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
	}
	const cards = doc
		.createPrimitive()
		.setMaterial(material)
		.setAttribute(
			'POSITION',
			doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer),
		)
		.setIndices(
			doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer),
		);
	mesh.addPrimitive(cards);
	// The wood: a closed tube of eight sides with four rings, which the simplifier narrows.
	const wood: number[] = [];
	const woodIndices: number[] = [];
	const [sides, rings] = [8, 4];
	for (let r = 0; r < rings; r++)
		for (let s = 0; s < sides; s++) {
			const angle = (s / sides) * Math.PI * 2;
			wood.push(Math.cos(angle) * 0.05, r * 0.3, Math.sin(angle) * 0.05);
		}
	for (let r = 0; r < rings - 1; r++)
		for (let s = 0; s < sides; s++) {
			const a = r * sides + s;
			const b = r * sides + ((s + 1) % sides);
			woodIndices.push(a, b, a + sides, b, b + sides, a + sides);
		}
	mesh.addPrimitive(
		doc
			.createPrimitive()
			.setMaterial(doc.createMaterial('bark'))
			.setAttribute(
				'POSITION',
				doc.createAccessor().setType('VEC3').setArray(new Float32Array(wood)).setBuffer(buffer),
			)
			.setIndices(
				doc
					.createAccessor()
					.setType('SCALAR')
					.setArray(new Uint32Array(woodIndices))
					.setBuffer(buffer),
			),
	);
	const node = doc.createNode('tree').setMesh(mesh);
	doc.createScene().addChild(node);
	return { doc, mesh, cards };
}

/** The cards' triangles that a primitive's indices draw. */
const triangles = (prim: Primitive) => (prim.getIndices()?.getCount() ?? 0) / 3;

describe('levels of detail for leaf cards', () => {
	it('keeps a share of the cards at each level, grown about their middles', async () => {
		const { doc, mesh, cards } = treeDocument();
		const plans = await planLevels(doc);
		const plan = plans.get(mesh);
		expect(plan).toBeDefined();
		const levels = plan?.levels ?? [];
		expect(levels.length).toBeGreaterThanOrEqual(2);
		// Each level keeps half of the level above's cards.
		const counts = levels.map((level) => (level.indices[0]?.length ?? 0) / 6);
		expect(counts[0]).toBe(CARDS / 2);
		expect(counts[1]).toBe(CARDS / 4);
		// The wood's list keeps the base positions; the cards' list moves them outward.
		expect(levels[0]?.positions[1]).toBeUndefined();
		const grown = levels[0]?.positions[0];
		expect(grown).toBeInstanceOf(Float32Array);
		// A kept card's corners move from the card's middle by the square root of two. The first
		// kept card's four vertices are the indices of its two triangles.
		const base = cards.getAttribute('POSITION')?.getArray();
		if (!(base instanceof Float32Array)) throw new Error('the cards have no positions');
		const indices0 = levels[0]?.indices[0] as Uint32Array;
		const kept = [...new Set(indices0.subarray(0, 6))];
		expect(kept).toHaveLength(4);
		const centre = [0, 1, 2].map(
			(c) => kept.reduce((sum, v) => sum + (base[v * 3 + c] as number), 0) / kept.length,
		);
		const reach = (values: Float32Array, v: number) =>
			Math.hypot(...[0, 1, 2].map((c) => (values[v * 3 + c] as number) - (centre[c] as number)));
		for (const v of kept)
			expect(reach(grown as Float32Array, v) / reach(base, v)).toBeCloseTo(Math.SQRT2, 3);
		// The error of a card level is the size of the cards that it drops, and grows from level to
		// level.
		expect(levels[0]?.error).toBeCloseTo(Math.hypot(CARD, CARD), 5);
		for (let k = 1; k < levels.length; k++)
			expect(levels[k]?.error).toBeGreaterThanOrEqual(
				(levels[k - 1]?.error as number) * 1.5 * (1 - 1e-6),
			);
	});

	it('writes each card level its own positions, and shares the wood stream', async () => {
		const { doc, mesh, cards } = treeDocument();
		const plans = await planLevels(doc);
		storeLevels(doc, plans);
		const found = mesh.listParents().find((p) => p.propertyType === 'Node');
		const level = found && lodOf(found as unknown as Node)?.listLevels()[0];
		if (!level) throw new Error('the mesh has no level');
		const levelMesh = level.getMesh();
		if (!levelMesh) throw new Error('the level has no mesh');
		const [levelCards, levelWood] = levelMesh.listPrimitives() as [Primitive, Primitive];
		expect(levelCards.getAttribute('POSITION')).not.toBe(cards.getAttribute('POSITION'));
		expect(levelCards.getAttribute('POSITION')?.getArray()).toBeInstanceOf(Float32Array);
		const wood = mesh.listPrimitives()[1];
		expect(levelWood.getAttribute('POSITION')).toBe(wood ? wood.getAttribute('POSITION') : null);
		// The cards' other streams still come from the base mesh.
		expect(levelCards.getIndices()).not.toBe(cards.getIndices());
		expect(triangles(levelCards)).toBe(CARDS);
	});

	it('treats a card folded along its middle as a card, as Creek makes its leaves', async () => {
		const doc = new Document();
		const buffer = doc.createBuffer();
		const mesh = doc.createMesh('leaves');
		const positions: number[] = [];
		const indices: number[] = [];
		// Each card is a strip of two quads: 6 vertices and 4 triangles.
		for (let k = 0; k < CARDS; k++) {
			const first = positions.length / 3;
			for (let row = 0; row < 2; row++)
				for (let col = 0; col < 3; col++) positions.push(k, row * CARD, col * CARD * 0.5);
			for (let col = 0; col < 2; col++) {
				const a = first + col;
				const b = a + 3;
				indices.push(a, a + 1, b + 1, a, b + 1, b);
			}
		}
		mesh.addPrimitive(
			doc
				.createPrimitive()
				.setMaterial(doc.createMaterial('leaves'))
				.setAttribute(
					'POSITION',
					doc
						.createAccessor()
						.setType('VEC3')
						.setArray(new Float32Array(positions))
						.setBuffer(buffer),
				)
				.setIndices(
					doc
						.createAccessor()
						.setType('SCALAR')
						.setArray(new Uint32Array(indices))
						.setBuffer(buffer),
				),
		);
		doc.createScene().addChild(doc.createNode('leaves').setMesh(mesh));
		const plan = (await planLevels(doc)).get(mesh);
		expect(plan).toBeDefined();
		// The first level keeps every second card: 20 of them, each 12 corners.
		expect(plan?.levels[0]?.indices[0]?.length).toBe((CARDS / 2) * 12);
	});

	it('leaves a list of separate triangles alone, so a flat-shaded surface keeps whole levels', async () => {
		const doc = new Document();
		const buffer = doc.createBuffer();
		const mesh = doc.createMesh('flat');
		const positions: number[] = [];
		const indices: number[] = [];
		for (let k = 0; k < 40; k++) {
			const first = positions.length / 3;
			// Each triangle stands apart, as a flat-shaded surface's faces do not.
			positions.push(k * 10, 0, 0, k * 10 + 1, 0, 0, k * 10, 1, 0);
			indices.push(first, first + 1, first + 2);
		}
		mesh.addPrimitive(
			doc
				.createPrimitive()
				.setMaterial(doc.createMaterial('flat'))
				.setAttribute(
					'POSITION',
					doc
						.createAccessor()
						.setType('VEC3')
						.setArray(new Float32Array(positions))
						.setBuffer(buffer),
				)
				.setIndices(
					doc
						.createAccessor()
						.setType('SCALAR')
						.setArray(new Uint32Array(indices))
						.setBuffer(buffer),
				),
		);
		doc.createScene().addChild(doc.createNode('flat').setMesh(mesh));
		const plans = await planLevels(doc);
		// No card step: the simplifier locks every border, so the list keeps its triangles and the
		// mesh gets no level.
		expect(plans.has(mesh)).toBe(false);
	});
});

/**
 * A flat grid of `n` by `n` quads across one metre, with each vertex's texture coordinate from
 * `uv`, or no texture coordinates when `uv` is null.
 */
function gridDocument(n: number, uv: ((x: number, z: number) => [number, number]) | null) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const mesh = doc.createMesh('grid');
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let r = 0; r <= n; r++)
		for (let c = 0; c <= n; c++) {
			const [x, z] = [c / n, r / n];
			positions.push(x, 0, z);
			if (uv) uvs.push(...uv(x, z));
		}
	for (let r = 0; r < n; r++)
		for (let c = 0; c < n; c++) {
			const at = r * (n + 1) + c;
			indices.push(at, at + n + 1, at + 1, at + 1, at + n + 1, at + n + 2);
		}
	const positionsAccessor = doc
		.createAccessor()
		.setType('VEC3')
		.setArray(new Float32Array(positions))
		.setBuffer(buffer);
	const primitive = doc
		.createPrimitive()
		.setMaterial(doc.createMaterial('grid'))
		.setAttribute('POSITION', positionsAccessor)
		.setIndices(
			doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer),
		);
	if (uv)
		primitive.setAttribute(
			'TEXCOORD_0',
			doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer),
		);
	mesh.addPrimitive(primitive);
	doc.createScene().addChild(doc.createNode('grid').setMesh(mesh));
	return { doc, mesh };
}

describe('texture coordinates in the levels error', () => {
	it('counts a texture that would slide, where a flat surface otherwise simplifies free', async () => {
		// A flat grid simplifies to a few triangles with no geometric error. Texture coordinates
		// that repeat across it keep the simplifier from sliding them, so a level's error grows.
		const flat = gridDocument(32, () => [0, 0]);
		const bent = gridDocument(32, (x, z) => [(x * 8) % 1, (z * 8) % 1]);
		const worst = async ({ doc, mesh }: ReturnType<typeof gridDocument>) => {
			const plan = (await planLevels(doc)).get(mesh);
			return Math.max(...(plan?.levels ?? []).map((level) => level.error));
		};
		const flatError = await worst(flat);
		const bentError = await worst(bent);
		expect(flatError).toBeGreaterThan(0);
		expect(bentError).toBeGreaterThan(flatError * 2);
	});
});
