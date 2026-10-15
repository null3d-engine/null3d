import { describe, expect, test } from 'bun:test';
import type { SketchContext, Texture } from '@null3d/engine';
import { createTerrain, type TerrainOptions } from './terrain';

/** A block's mesh as the fake geometry keeps it: the ground it holds, and its life. */
interface FakeMesh {
	side: number;
	destroyed: boolean;
	destroy(): void;
	updateVertices(name: string, values: Float32Array): void;
}

/** A block's object as the fake scene keeps it: its mesh, whether it draws, and its life. */
interface FakeBlock {
	mesh: FakeMesh;
	visible: boolean;
	destroyed: boolean;
	meshDestroyed: boolean;
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
	const texture = { destroy: () => {} } as unknown as Texture;
	const context = {
		textures: { fromData: () => texture },
		materials: { shader: () => ({ destroy: () => {} }) },
		geometry: {
			// The ground writes a block's vertices into whichever mesh it holds, so the mesh's side
			// follows the ground it now carries.
			fromArrays: (arrays: { positions: Float32Array }) => {
				const mesh: FakeMesh = {
					side: sideOf(arrays.positions),
					destroyed: false,
					destroy() {
						this.destroyed = true;
					},
					updateVertices(name: string, values: Float32Array) {
						if (name === 'positions') this.side = sideOf(values);
					},
				};
				return mesh;
			},
		},
		scene: {
			createMesh: ({ mesh }: { mesh: FakeMesh }) => {
				const block: FakeBlock = {
					mesh,
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
						block.meshDestroyed = mesh.destroyed;
					},
				};
			},
		},
	} as unknown as SketchContext;
	const visible = () => blocks.filter((b) => b.visible && !b.destroyed);
	const area = () => visible().reduce((sum, b) => sum + b.mesh.side * b.mesh.side, 0);
	return { context, blocks, visible, area };
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

/** Moves the camera to a place and lets every update that the new selection needs run. */
function settle(t: ReturnType<typeof terrain>, x: number, z: number): void {
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
		t.ground.update(10, 10);
		const made = t.blocks.length;
		t.ground.update(11, 12);
		expect(t.blocks.length).toBe(made);
	});

	test('a new cell builds at most blocksPerUpdate blocks per update and keeps the old ground until then', () => {
		const t = terrain({ blocksPerUpdate: 2 });
		t.ground.update(10, 10);
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

	test('setVisible(true) shows the current selection alone, not every cached block', () => {
		const t = terrain();
		t.ground.update(10, 10);
		t.ground.update(400, 400);
		t.ground.update(-400, 300);
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
		t.ground.update(10, 10);
		t.ground.setVisible(false);
		t.ground.update(400, 400);
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
		t.ground.update(10, 10);
		const before = t.visible();
		expect(before.length).toBeGreaterThan(16);
		t.ground.update(300, -200);
		expect(t.ground.building).toBe(true);
		while (t.ground.building) {
			expect(t.visible()).toEqual(before);
			t.ground.update(300, -200);
		}
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('destroy ends every block', () => {
		const t = terrain();
		t.ground.update(10, 10);
		t.ground.update(400, 400);
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
