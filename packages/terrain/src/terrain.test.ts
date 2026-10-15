import { describe, expect, test } from 'bun:test';
import type { SketchContext, Texture } from '@null3d/engine';
import type { ChunkArrays } from './chunk';
import { createTerrain, type TerrainOptions } from './terrain';

/** A block's object as the fake scene keeps it: its side, whether it draws, and its life. */
interface FakeBlock {
	side: number;
	visible: boolean;
	destroyed: boolean;
	meshDestroyed: boolean;
}

/** A sketch context with just what a terrain calls, which logs every block it makes. */
function fakeContext() {
	const blocks: FakeBlock[] = [];
	const texture = { destroy: () => {} } as unknown as Texture;
	const context = {
		textures: { fromData: () => texture },
		materials: { shader: () => ({ destroy: () => {} }) },
		geometry: {
			// A block's grid starts at its low corner, so the largest x is the block's side.
			fromArrays: (arrays: ChunkArrays) => {
				let side = 0;
				for (let i = 0; i < arrays.positions.length; i += 3)
					side = Math.max(side, arrays.positions[i] as number);
				return {
					side,
					destroyed: false,
					destroy() {
						this.destroyed = true;
					},
				};
			},
		},
		scene: {
			createMesh: ({ mesh }: { mesh: { side: number; destroyed: boolean } }) => {
				const block: FakeBlock = {
					side: mesh.side,
					visible: true,
					destroyed: false,
					meshDestroyed: false,
				};
				blocks.push(block);
				return {
					setVisible: (visible: boolean) => {
						block.visible = visible;
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
	const area = () => visible().reduce((sum, b) => sum + b.side * b.side, 0);
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

	test('past maxBlocks, the blocks that no selection draws are destroyed, object then mesh', () => {
		const t = terrain({ maxBlocks: 64 });
		for (let k = 0; k < 20; k++) t.ground.update(-500 + k * 50, (k % 5) * 100 - 250);
		// While a selection builds, the ground keeps the blocks of the one it draws too.
		while (t.ground.building) t.ground.update(450, -50);
		const kept = t.blocks.filter((b) => !b.destroyed);
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
