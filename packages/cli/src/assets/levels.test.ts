import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, type Node, type Primitive } from '@gltf-transform/core';
import { MODELS_DIR, terrainDocument } from './cluster-fixture.js';
import {
	orderLevels,
	planLevels,
	STAGE_HEADER_SIZE,
	STAGE_LEVELS,
	STAGE_MAGIC,
	STAGE_VERSION,
	storeLevels,
	storeStages,
} from './levels.js';
import { lodOf } from './lod-extension.js';
import { buildStagedModel, STAGED_FILE } from './staged-fixture.js';

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

describe('the coarsest-first vertex order', () => {
	it('puts each level’s vertices in a prefix of its base and keeps every triangle', async () => {
		const { doc, mesh } = treeDocument();
		const plans = await planLevels(doc);
		const plan = plans.get(mesh);
		expect(plan).toBeDefined();
		if (!plan) return;
		const prims = plan.prims;
		// The positions each level's triangles drew before the reorder, and the base's own.
		const before = plan.levels.map((level) =>
			level.indices.map((indices, p) => {
				const positions =
					level.positions[p] ?? (prims[p]?.getAttribute('POSITION')?.getArray() as Float32Array);
				return { indices: Uint32Array.from(indices), positions: Float32Array.from(positions) };
			}),
		);
		const base = prims.map((prim) => ({
			indices: Uint32Array.from(prim.getIndices()?.getArray() ?? []),
			positions: Float32Array.from(prim.getAttribute('POSITION')?.getArray() as Float32Array),
		}));
		orderLevels(doc, plans);
		prims.forEach((prim, p) => {
			const positions = prim.getAttribute('POSITION')?.getArray() as Float32Array;
			const indices = prim.getIndices()?.getArray() as ArrayLike<number>;
			const old = base[p] as { indices: Uint32Array; positions: Float32Array };
			for (let i = 0; i < indices.length; i++)
				for (let c = 0; c < 3; c++)
					expect(positions[(indices[i] as number) * 3 + c]).toBeCloseTo(
						old.positions[(old.indices[i] as number) * 3 + c] as number,
						5,
					);
			// Each level and the levels coarser than it share one prefix of the new order.
			for (let k = plan.levels.length - 1; k >= 0; k--) {
				const used = new Set<number>();
				for (let j = k; j < plan.levels.length; j++)
					for (const vertex of plan.levels[j]?.indices[p] ?? []) used.add(vertex);
				const farthest = Math.max(...used);
				expect(farthest).toBeLessThan(used.size);
			}
		});
		// Every level still draws the positions its triangles drew before the reorder.
		plan.levels.forEach((level, k) => {
			prims.forEach((prim, p) => {
				const positions = (level.positions[p] ??
					prim.getAttribute('POSITION')?.getArray()) as Float32Array;
				const indices = level.indices[p] as Uint32Array;
				const old = before[k]?.[p];
				if (!old) return;
				for (let i = 0; i < indices.length; i++)
					for (let c = 0; c < 3; c++)
						expect(positions[(indices[i] as number) * 3 + c]).toBeCloseTo(
							old.positions[(old.indices[i] as number) * 3 + c] as number,
							5,
						);
			});
		});
	});
});

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

/** The lists that a stage file holds, read as the engine reads them. */
function stageLists(bytes: Uint8Array): Uint32Array[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	expect([view.getUint32(0, true), view.getUint32(4, true), view.getUint32(8, true)]).toEqual([
		STAGE_MAGIC,
		STAGE_VERSION,
		STAGE_LEVELS,
	]);
	const lists: Uint32Array[] = [];
	let at = STAGE_HEADER_SIZE * 4;
	for (let k = 0; k < view.getUint32(12, true); k++) {
		const length = view.getUint32(at, true);
		const width = view.getUint32(at + 4, true);
		const bytesOf = Math.ceil((length * width) / 4) * 4;
		const list = new Uint32Array(length);
		if (width === 2) list.set(new Uint16Array(bytes.buffer, bytes.byteOffset + at + 8, length));
		else list.set(new Uint32Array(bytes.buffer, bytes.byteOffset + at + 8, length));
		lists.push(list);
		at += 8 + bytesOf;
	}
	expect(at).toBe(bytes.byteLength);
	return lists;
}

describe('levels as separate downloads', () => {
	it('keeps the coarsest level in the file and writes each finer one to a stage, coarsest first', async () => {
		const doc = terrainDocument();
		const plans = await planLevels(doc);
		const mesh = doc.getRoot().listMeshes()[0];
		if (!mesh) throw new Error('the terrain has no mesh');
		const plan = plans.get(mesh);
		if (!plan) throw new Error('the terrain has no levels');
		const levels = plan.levels;
		expect(levels.length).toBeGreaterThanOrEqual(2);
		const stages = new Map<string, Uint8Array>();
		const prim = mesh.listPrimitives()[0] as Primitive;
		const own = Array.from(prim.getIndices()?.getArray() ?? []);
		const summary = storeStages(doc, plans, stages, 'model');
		expect(summary.meshes).toBe(1);
		// The file draws its coarsest level, over the mesh's full vertex stream.
		const coarsest = levels[levels.length - 1];
		expect(Array.from(prim.getIndices()?.getArray() ?? [])).toEqual(
			Array.from(coarsest?.indices[0] ?? []),
		);
		expect(prim.getAttribute('POSITION')?.getCount()).toBeGreaterThan(
			new Set(coarsest?.indices[0]).size,
		);
		// A stage for each finer level and one for the mesh itself, from the coarsest down.
		expect(stages.size).toBe(levels.length);
		expect(summary.files).toBe(stages.size);
		const node = mesh.listParents().find((p) => p.propertyType === 'Node') as Node;
		const staged = node.getExtras().NULL3D_stages as {
			error: number;
			levels: { url: string; bytes: number; error: number }[];
		};
		expect(staged.error).toBeCloseTo(coarsest?.error as number, 5);
		expect(staged.levels).toHaveLength(levels.length);
		levels.slice(0, -1).forEach((level, k) => {
			const entry = staged.levels[levels.length - 2 - k];
			if (!entry) throw new Error(`the node names no stage ${k}`);
			// The first stage holds the level after the file's own, and the last the mesh itself.
			expect(entry.error).toBeCloseTo(level.error, 5);
			const file = stages.get(entry.url);
			if (!file) throw new Error(`the tool wrote no ${entry.url}`);
			expect(file.byteLength).toBe(entry.bytes);
			expect(Array.from(stageLists(file)[0] ?? [])).toEqual(Array.from(level.indices[0] ?? []));
		});
		// The last stage is the mesh itself, exact, so the finest picture is the full mesh.
		const last = staged.levels[staged.levels.length - 1];
		if (!last) throw new Error('the node names no last stage');
		expect(last.error).toBe(0);
		expect(Array.from(stageLists(stages.get(last.url) as Uint8Array)[0] ?? [])).toEqual(own);
		// The levels that stay in the file would have named their level nodes.
		expect(lodOf(node)).toBeNull();
	});

	it('keeps whole levels in the file for a mesh whose levels hold positions of their own', async () => {
		const { doc, mesh } = treeDocument();
		const plans = await planLevels(doc);
		const stages = new Map<string, Uint8Array>();
		storeStages(doc, plans, stages, 'model');
		expect(stages.size).toBe(0);
		const node = mesh.listParents().find((p) => p.propertyType === 'Node') as Node;
		expect(lodOf(node)?.listLevels().length).toBeGreaterThan(0);
		expect(node.getExtras().NULL3D_stages).toBeUndefined();
	});
});

describe('the staged test model', () => {
	it('holds what the tool builds from the heightfield, and its stages beside it', async () => {
		const model = await buildStagedModel();
		const committed = readFileSync(join(MODELS_DIR, STAGED_FILE));
		expect(Buffer.from(model.glb).equals(committed)).toBe(true);
		for (const [name, bytes] of model.stages) {
			const file = readFileSync(join(MODELS_DIR, name));
			expect(Buffer.from(bytes).equals(file), name).toBe(true);
		}
	}, 180_000);
});
