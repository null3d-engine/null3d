import { describe, expect, test } from 'bun:test';
import type { SketchContext, Texture } from '@null3d/engine';
import { createTerrain, type TerrainOptions } from './terrain';

/** A block's mesh as the fake geometry keeps it: the side of the ground it holds, and its life. */
interface FakeMesh {
	side: number;
	destroyed: boolean;
}

/** A block's object as the fake scene keeps it: whether it draws, and its life. */
interface FakeBlock {
	mesh: FakeMesh;
	visible: boolean;
	destroyed: boolean;
	meshDestroyed: boolean;
}

/** The largest x among a block's positions, which is its side: a block's grid starts at its corner. */
function sideOf(positions: ArrayLike<number>): number {
	let side = 0;
	for (let i = 0; i < positions.length; i += 3) side = Math.max(side, positions[i] as number);
	return side;
}

/**
 * A sketch context with just what a terrain calls. It logs every block it makes, and counts the
 * meshes it makes and the meshes that a second block takes over.
 */
function fakeContext() {
	const blocks: FakeBlock[] = [];
	let meshes = 0;
	let handedOver = 0;
	const texture = { destroy: () => {} } as unknown as Texture;
	const context = {
		textures: { fromData: () => texture },
		materials: { shader: () => ({ destroy: () => {} }) },
		geometry: {
			fromArrays: (arrays: { positions: Float32Array }) => {
				meshes++;
				const record: FakeMesh = { side: sideOf(arrays.positions), destroyed: false };
				return {
					record,
					destroy: () => {
						record.destroyed = true;
					},
					updateVertices: (name: string, values: Float32Array) => {
						if (name !== 'positions') return;
						record.side = sideOf(values);
						handedOver++;
					},
				};
			},
		},
		scene: {
			createMesh: ({ mesh }: { mesh: { record: FakeMesh } }) => {
				const block: FakeBlock = {
					mesh: mesh.record,
					visible: true,
					destroyed: false,
					meshDestroyed: false,
				};
				blocks.push(block);
				return {
					setVisible: (visible: boolean) => {
						block.visible = visible;
					},
					setPosition: () => {},
					setBounds: () => {},
					destroy: () => {
						block.destroyed = true;
						// The block's mesh may only end after its object, so this reads as false.
						block.meshDestroyed = block.mesh.destroyed;
					},
				};
			},
		},
	} as unknown as SketchContext;
	const live = () => blocks.filter((b) => !b.destroyed);
	const visible = () => blocks.filter((b) => b.visible && !b.destroyed);
	const area = () => visible().reduce((sum, b) => sum + b.mesh.side * b.mesh.side, 0);
	const aliveMeshes = () => new Set(live().map((b) => b.mesh)).size;
	return {
		context,
		blocks,
		live,
		visible,
		area,
		meshes: () => meshes,
		aliveMeshes,
		handedOver: () => handedOver,
	};
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
		chunkQuads: 2,
		layers: [layer],
		maxLevel: 5,
		...options,
	});
	return { ...fake, ground };
}

/** Runs the updates until the ground's newest selection is built, from `x` and `z`. */
function settle(t: ReturnType<typeof terrain>, x: number, z: number) {
	t.ground.update(x, z);
	while (t.ground.building) t.ground.update(x, z);
}

describe('terrain updates', () => {
	test('the first update builds its whole selection, which tiles the ground once', () => {
		const t = terrain({ blocksPerUpdate: 1 });
		t.ground.update(10, 10);
		expect(t.ground.building).toBe(false);
		expect(t.visible().length).toBe(t.ground.drawn);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('a still camera does no work', () => {
		const t = terrain();
		settle(t, 10, 10);
		const made = t.blocks.length;
		t.ground.update(11, 12);
		expect(t.blocks.length).toBe(made);
	});

	test('a new cell builds at most blocksPerUpdate blocks per update and keeps the old ground until then', () => {
		const t = terrain({ blocksPerUpdate: 2 });
		settle(t, 10, 10);
		const before = t.visible();
		// Far enough that the new cell needs more than two new blocks.
		t.ground.update(300, -200);
		let updates = 1;
		while (t.ground.building) {
			expect(t.visible()).toEqual(before);
			const made = t.blocks.length;
			t.ground.update(300, -200);
			expect(t.blocks.length - made).toBeLessThanOrEqual(2);
			updates++;
		}
		expect(updates).toBeGreaterThan(1);
		expect(t.visible()).not.toEqual(before);
		expect(t.visible().length).toBe(t.ground.drawn);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('a new selection hands the meshes it no longer draws to the blocks it needs', () => {
		const t = terrain({ maxBlocks: 32, blocksPerUpdate: 4 });
		for (let k = 0; k <= 12; k++) settle(t, -500 + k * 80, 200);
		// The ground builds a mesh while it holds fewer than its limit, and takes over the meshes of
		// the blocks that the new selection leaves out from then on.
		expect(t.handedOver()).toBeGreaterThan(0);
		expect(t.aliveMeshes()).toBeLessThanOrEqual(Math.max(32, t.ground.drawn));
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('setVisible(true) shows the current selection alone, not every block the ground keeps', () => {
		const t = terrain();
		t.ground.update(10, 10);
		t.ground.update(400, 400);
		t.ground.update(-400, 300);
		expect(t.live().length).toBeGreaterThan(t.ground.drawn);
		t.ground.setVisible(false);
		expect(t.visible()).toEqual([]);
		expect(t.ground.drawn).toBe(0);
		t.ground.setVisible(true);
		expect(t.visible().length).toBe(t.ground.drawn);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('a hidden ground stays hidden while the camera moves', () => {
		const t = terrain();
		settle(t, 10, 10);
		t.ground.setVisible(false);
		settle(t, 400, 400);
		expect(t.visible()).toEqual([]);
		t.ground.setVisible(true);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('past maxBlocks, the meshes that waited longest are destroyed, object then mesh', () => {
		const t = terrain({ maxBlocks: 64 });
		for (let k = 0; k < 20; k++) settle(t, -500 + k * 50, (k % 5) * 100 - 250);
		settle(t, 450, -50);
		const kept = t.live();
		expect(kept.length).toBeLessThanOrEqual(Math.max(64, t.ground.drawn));
		const ended = t.blocks.filter((b) => b.destroyed);
		expect(ended.length).toBeGreaterThan(0);
		for (const block of ended) {
			expect(block.visible).toBe(false);
			expect(block.meshDestroyed).toBe(false);
		}
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('destroy ends every block', () => {
		const t = terrain();
		settle(t, 10, 10);
		settle(t, 400, 400);
		t.ground.destroy();
		expect(t.blocks.every((b) => b.destroyed)).toBe(true);
		t.ground.update(0, 0);
		expect(t.blocks.every((b) => b.destroyed)).toBe(true);
	});

	test('createTerrain refuses a split or blocksPerUpdate out of range', () => {
		expect(() => terrain({ split: 9 })).toThrow('up to 8');
		expect(() => terrain({ blocksPerUpdate: 0 })).toThrow('blocksPerUpdate');
	});
});
