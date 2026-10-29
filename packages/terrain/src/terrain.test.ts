import { describe, expect, test } from 'bun:test';
import type { SketchContext, Texture } from '@null3d/engine';
import { createTerrain, type TerrainOptions } from './terrain';

/** A block's mesh as the fake geometry keeps it: the ground it holds, and its life. */
interface FakeMesh {
	side: number;
	destroyed: boolean;
	/** The four-number vertex record that the mesh was made with. */
	targets?: Float32Array;
	destroy(): void;
	updateVertices(name: string, values: Float32Array): void;
}

/** A block's object as the fake scene keeps it: its mesh, whether it draws, and its life. */
interface FakeBlock {
	mesh: FakeMesh;
	visible: boolean;
	destroyed: boolean;
	meshDestroyed: boolean;
	/** The vertices the block's mesh was made with, which its bounds must hold. */
	positions: Float32Array;
	/** The sphere the object was given, and how many times it was given one. */
	bounds: { center: readonly [number, number, number]; radius: number } | undefined;
	boundsCalls: number;
}

/**
 * The side of a block, read from the vertices just written into its mesh: a block's grid starts at
 * its own low corner, so the largest x is the block's side.
 */
function sideOf(positions: Float32Array): number {
	let side = 0;
	for (let i = 0; i < positions.length; i += 3) side = Math.max(side, positions[i] as number);
	return side;
}

/** A sketch context with just what a terrain calls, which logs every block it makes. */
function fakeContext() {
	const blocks: FakeBlock[] = [];
	const selections: { selection: [number, number] }[] = [];
	const texture = () => ({ destroy: () => {} }) as unknown as Texture;
	const context = {
		textures: { fromData: texture },
		materials: {
			shader: () => ({
				destroy: () => {},
				set: (values: { selection: [number, number] }) => {
					selections.push({ selection: [values.selection[0], values.selection[1]] });
				},
			}),
		},
		// The ground picks blocks from the drawing buffer's height and the preset's detail.
		engine: { viewport: { width: 1920, height: 1080, pixelRatio: 1 } },
		quality: { settings: { lodThreshold: 1, maxRenderScale: 1 } },
		geometry: {
			// The ground writes a block's vertices into whichever mesh it holds, so the mesh's side
			// follows the ground it now carries.
			fromArrays: (arrays: { positions: Float32Array; targets?: Float32Array }) => {
				const kept = arrays.positions.slice();
				const mesh: FakeMesh = {
					side: sideOf(arrays.positions),
					destroyed: false,
					destroy() {
						this.destroyed = true;
					},
					updateVertices(name: string, values: Float32Array) {
						if (name === 'positions') this.side = sideOf(values);
						if (name === 'targets') this.targets = values.slice();
					},
				};
				if (arrays.targets) mesh.targets = arrays.targets.slice();
				(mesh as FakeMesh & { positions: Float32Array }).positions = kept;
				return mesh;
			},
		},
		scene: {
			createMesh: ({ mesh }: { mesh: FakeMesh & { positions?: Float32Array } }) => {
				const block: FakeBlock = {
					mesh,
					visible: true,
					destroyed: false,
					meshDestroyed: false,
					positions: mesh.positions ?? new Float32Array(0),
					bounds: undefined,
					boundsCalls: 0,
				};
				blocks.push(block);
				return {
					setVisible: (visible: boolean) => {
						block.visible = visible;
					},
					setPosition: () => {},
					setBounds: (center: readonly [number, number, number], radius: number) => {
						block.bounds = { center: [center[0], center[1], center[2]], radius };
						block.boundsCalls++;
					},
					destroy: () => {
						block.destroyed = true;
						block.meshDestroyed = mesh.destroyed;
					},
				};
			},
		},
	} as unknown as SketchContext;
	const visible = () => blocks.filter((b) => b.visible && !b.destroyed);
	const area = () => visible().reduce((sum, b) => sum + b.mesh.side * b.mesh.side, 0);
	return { context, blocks, selections, visible, area };
}

const SIZE = 1024;
const layer = { map: {} as Texture };

function terrain(options: Partial<TerrainOptions> = {}) {
	const fake = fakeContext();
	const ground = createTerrain(fake.context, {
		size: SIZE,
		height: () => 0,
		resolution: 8,
		splatResolution: 2,
		chunkQuads: 16,
		layers: [layer],
		maxLevel: 5,
		...options,
	});
	return { ...fake, ground };
}

/** Moves the camera to a place and lets every update that the new selection needs run. */
function settle(t: ReturnType<typeof terrain>, x: number, z: number, y = 0): void {
	t.ground.update([x, y, z]);
	while (t.ground.building) t.ground.update([x, y, z]);
}

describe('terrain updates', () => {
	test('the first update builds its whole selection, which tiles the ground once', () => {
		const t = terrain({ blocksPerUpdate: 1 });
		t.ground.update([10, 0, 10]);
		expect(t.ground.building).toBe(false);
		expect(t.visible().length).toBe(t.ground.drawn);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('a still camera does no work', () => {
		const t = terrain();
		t.ground.update([10, 0, 10]);
		const made = t.blocks.length;
		t.ground.update([11, 0, 12]);
		expect(t.blocks.length).toBe(made);
	});

	test('a new cell builds at most blocksPerUpdate blocks per update and keeps the old ground until then', () => {
		const t = terrain({ blocksPerUpdate: 2 });
		t.ground.update([10, 0, 10]);
		const before = t.visible();
		// Far enough that the new cell needs more than two new blocks.
		t.ground.update([300, 0, -200]);
		let updates = 1;
		while (t.ground.building) {
			expect(t.visible()).toEqual(before);
			const made = t.blocks.length;
			t.ground.update([300, 0, -200]);
			expect(t.blocks.length - made).toBeLessThanOrEqual(2);
			updates++;
		}
		expect(updates).toBeGreaterThan(1);
		expect(t.visible()).not.toEqual(before);
		expect(t.visible().length).toBe(t.ground.drawn);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('setVisible(true) shows the current selection alone, not every cached block', () => {
		const t = terrain();
		t.ground.update([10, 0, 10]);
		t.ground.update([400, 0, 400]);
		t.ground.update([-400, 0, 300]);
		expect(t.blocks.filter((b) => !b.destroyed).length).toBeGreaterThan(t.ground.drawn);
		t.ground.setVisible(false);
		expect(t.visible()).toEqual([]);
		expect(t.ground.drawn).toBe(0);
		t.ground.setVisible(true);
		expect(t.visible().length).toBe(t.ground.drawn);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('a hidden ground stays hidden while the camera moves', () => {
		const t = terrain();
		t.ground.update([10, 0, 10]);
		t.ground.setVisible(false);
		t.ground.update([400, 0, 400]);
		expect(t.visible()).toEqual([]);
		t.ground.setVisible(true);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('past maxBlocks, the ground holds no more meshes than its cap or one selection', () => {
		const t = terrain({ maxBlocks: 64 });
		for (let k = 0; k < 20; k++) settle(t, -500 + k * 50, (k % 5) * 100 - 250);
		const kept = t.blocks.filter((b) => !b.destroyed);
		// A selection draws more blocks than the cap, so the ground holds one selection of meshes
		// and gives up the ones that no selection draws.
		expect(t.ground.drawn).toBeGreaterThan(64);
		expect(kept.length).toBeLessThanOrEqual(t.ground.drawn);
		const ended = t.blocks.filter((b) => b.destroyed);
		expect(ended.length).toBeGreaterThan(0);
		for (const block of ended) {
			expect(block.visible).toBe(false);
			// The object goes first, so its mesh is still there at that moment.
			expect(block.meshDestroyed).toBe(false);
		}
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('the ground takes the meshes that no selection draws before it builds new ones', () => {
		const t = terrain();
		// Two places far apart: each move needs almost its whole selection built again, and the
		// ground holds the meshes of the selection that it leaves behind.
		for (let k = 0; k < 10; k++) settle(t, k % 2 === 0 ? -400 : 400, 100);
		expect(t.blocks.length).toBeLessThan(t.ground.drawn * 4);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('the last complete ground stays whole while the new one builds at the pool limit', () => {
		// A pool smaller than one selection holds no spare mesh, so a build that cannot take one
		// must not take the mesh of a block that still draws.
		const t = terrain({ blocksPerUpdate: 2, maxBlocks: 16 });
		t.ground.update([10, 0, 10]);
		const before = t.visible();
		expect(before.length).toBeGreaterThan(16);
		t.ground.update([300, 0, -200]);
		expect(t.ground.building).toBe(true);
		while (t.ground.building) {
			expect(t.visible()).toEqual(before);
			t.ground.update([300, 0, -200]);
		}
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('destroy ends every block', () => {
		const t = terrain();
		t.ground.update([10, 0, 10]);
		t.ground.update([400, 0, 400]);
		t.ground.destroy();
		expect(t.blocks.every((b) => b.destroyed)).toBe(true);
		t.ground.update([0, 0, 0]);
		expect(t.blocks.every((b) => b.destroyed)).toBe(true);
	});

	test('createTerrain refuses an error or blocksPerUpdate out of range', () => {
		expect(() => terrain({ error: -1 })).toThrow('0 or more');
		expect(() => terrain({ error: Number.POSITIVE_INFINITY })).toThrow('0 or more');
		expect(() => terrain({ blocksPerUpdate: 0 })).toThrow('blocksPerUpdate');
	});

	test('a high camera picks coarser blocks under it', () => {
		const t = terrain();
		settle(t, 10, 10, 0);
		const near = t.ground.drawn;
		settle(t, 10, 10, 500);
		expect(t.ground.drawn).toBeLessThan(near);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('the ground picks again when the camera rises without moving across', () => {
		const t = terrain();
		settle(t, 10, 10, 0);
		const before = t.ground.drawn;
		settle(t, 10, 10, 400);
		expect(t.ground.drawn).toBeLessThan(before);
	});
});

describe('terrain block spheres', () => {
	/** The skirt the test sets, which every block's sphere must cover below the ground. */
	const SKIRT = 5;

	test("a block's bounds are centred on its middle and hold every vertex of its mesh", () => {
		const t = terrain({
			skirt: SKIRT,
			height: (x: number, z: number) => Math.sin(x / 40) * 20 + Math.cos(z / 60) * 12,
		});
		settle(t, 10, 10);
		expect(t.blocks.length).toBeGreaterThan(0);
		// A level's block size identifies it, so the radii its blocks report are gathered by it.
		const levelRadii = new Map<number, { radius: number; blocks: number }>();
		const { min, max } = t.ground.heightfield;
		for (const block of t.blocks) {
			expect(block.bounds).toBeDefined();
			const { center, radius } = block.bounds as {
				center: readonly [number, number, number];
				radius: number;
			};
			let farthest = 0;
			let corner = 0;
			let maxX = 0;
			let maxZ = 0;
			for (let at = 0; at < block.positions.length; at += 3) {
				const x = block.positions[at] as number;
				const y = block.positions[at + 1] as number;
				const z = block.positions[at + 2] as number;
				farthest = Math.max(farthest, Math.hypot(x - center[0], y - center[1], z - center[2]));
				corner = Math.max(corner, Math.hypot(x, y, z));
				maxX = Math.max(maxX, x);
				maxZ = Math.max(maxZ, z);
			}
			expect(farthest).toBeLessThanOrEqual(radius + 1e-3);
			// The sphere sits on the block's middle across its two sides, not on its low corner.
			expect(center[0]).toBeCloseTo(maxX / 2, 6);
			expect(center[2]).toBeCloseTo(maxZ / 2, 6);
			expect(corner).toBeGreaterThan(0);
			// Every block of a level reports the same radius, and its block size identifies the level.
			const level = levelRadii.get(maxX);
			if (level) {
				expect(radius).toBe(level.radius);
				level.blocks++;
			} else {
				levelRadii.set(maxX, { radius, blocks: 1 });
			}
			// No larger than the level's ground needs: the diagonal across the block's two sides,
			// and half the height range that its ground spans, the skirt below it included.
			const required = Math.hypot(maxX / Math.SQRT2, (max - (min - SKIRT)) / 2);
			expect(radius).toBeLessThanOrEqual(required + 1e-3);
		}
		// A shared radius means something only where a level holds more than one block, and the
		// selection covers more than one level.
		expect(levelRadii.size).toBeGreaterThan(1);
		for (const level of levelRadii.values()) expect(level.blocks).toBeGreaterThan(1);
	});

	test('writes each block its parent surface and its height box for the morph', () => {
		const t = terrain();
		settle(t, 10, 10);
		const morphed = t.visible();
		expect(morphed.length).toBeGreaterThan(1);
		const sizes = new Set<number>();
		for (const block of morphed) {
			const record = block.mesh.targets as Float32Array;
			const vertices = block.positions.length / 3;
			expect(record.length).toBe(vertices * 4);
			// The size, the low and the high are the same at every vertex of a block.
			const size = record[1] as number;
			const low = record[2] as number;
			const high = record[3] as number;
			expect(size).toBeGreaterThan(0);
			expect(low).toBeLessThanOrEqual(high);
			sizes.add(size);
			for (let v = 0; v < vertices; v++) {
				expect(record[v * 4 + 1]).toBe(size);
				expect(record[v * 4 + 2]).toBe(low);
				expect(record[v * 4 + 3]).toBe(high);
				expect(Number.isFinite(record[v * 4] as number)).toBe(true);
			}
		}
		// The selection holds more than one level, so the blocks differ in size.
		expect(sizes.size).toBeGreaterThan(1);
	});

	test('moves the selection scale with setMorph', () => {
		const t = terrain();
		settle(t, 10, 10);
		const before = (t.selections.at(-1) as { selection: [number, number] }).selection[0];
		expect(before).toBeGreaterThan(0);
		t.ground.setMorph(false);
		expect((t.selections.at(-1) as { selection: [number, number] }).selection[0]).toBe(0);
		t.ground.setMorph(true);
		expect((t.selections.at(-1) as { selection: [number, number] }).selection[0]).toBeCloseTo(
			before,
			9,
		);
	});

	test('writes the record with the morph off too, which moves nothing', () => {
		const t = terrain({ morph: false });
		settle(t, 10, 10);
		for (const block of t.visible())
			expect((block.mesh.targets as Float32Array).length).toBe((block.positions.length / 3) * 4);
	});

	test('a cell crossing gives no block that already draws new bounds', () => {
		const t = terrain({ maxBlocks: 64 });
		settle(t, 10, 10);
		const existing = t.blocks.slice();
		settle(t, 200, 10);
		expect(existing.length).toBeGreaterThan(0);
		for (const block of existing) expect(block.boundsCalls).toBe(1);
	});
});
