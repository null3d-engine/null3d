import { describe, expect, test } from 'bun:test';
import type { Scene, SpriteBatch, SpriteOptions, Texture } from '@null3d/engine';
import { createImpostors, ImpostorBatch } from './batch';
import { frameDirection, impostorFrame, type OctahedralAtlas } from './octahedral';

/** A stand-in for the engine's sprite batch: its row arrays, and the ranges marked dirty. */
function fakeSprites(count: number) {
	const marks: [number, number][] = [];
	return {
		count,
		positions: new Float32Array(count * 3),
		sizes: new Float32Array(count * 2),
		colors: new Float32Array(count * 4),
		frames: new Uint32Array(count),
		marks,
		markDirty(start = 0, rows = count - start) {
			marks.push([start, rows]);
		},
		destroy() {},
	};
}

type FakeSprites = ReturnType<typeof fakeSprites>;

const ATLAS: OctahedralAtlas = { columns: 3, rows: 3 };

/** An impostor batch over a stand-in sprite batch, with the cards at `positions`. */
function batchOf(
	positions: readonly number[],
	origin?: readonly [number, number, number],
): { batch: ImpostorBatch; sprites: FakeSprites } {
	const sprites = fakeSprites(positions.length / 3);
	sprites.positions.set(positions);
	const batch = new ImpostorBatch(sprites as unknown as SpriteBatch, ATLAS, origin);
	return { batch, sprites };
}

describe('ImpostorBatch.update', () => {
	test('shows each card the view from its direction toward the eye', () => {
		// One card east of the eye, one west, one in front and one behind.
		const { batch, sprites } = batchOf([10, 0, 0, -10, 0, 0, 0, 0, 10, 0, 0, -10]);
		batch.update([0, 0, 0]);
		expect(Array.from(sprites.frames)).toEqual([
			impostorFrame([-1, 0, 0], ATLAS),
			impostorFrame([1, 0, 0], ATLAS),
			impostorFrame([0, 0, -1], ATLAS),
			impostorFrame([0, 0, 1], ATLAS),
		]);
		// The view a card shows was drawn from the side that faces the eye.
		expect(frameDirection(sprites.frames[0] as number, ATLAS)[0]).toBeLessThan(0);
		expect(frameDirection(sprites.frames[1] as number, ATLAS)[0]).toBeGreaterThan(0);
	});

	test("reads the cards' positions relative to the batch's origin", () => {
		// The card sits 10 units behind an origin far out along x, and the eye is at that origin.
		const { batch, sprites } = batchOf([0, 0, -10], [10_000, 0, 0]);
		batch.update([10_000, 0, 0]);
		expect(sprites.frames[0]).toBe(impostorFrame([0, 0, 1], ATLAS));
		expect(sprites.frames[0]).toBe(4);
	});

	test('marks only the cards whose view changed', () => {
		// Two cards far out east and west, whose views a small move of the eye keeps, and one card
		// in front of the eye.
		const { batch, sprites } = batchOf([1000, 0, 0, -1000, 0, 0, 0, 0, -10]);
		batch.update([0, 0, 0]);
		// Every card changed from frame 0, and the three share one range.
		expect(sprites.marks).toEqual([[0, 3]]);
		sprites.marks.length = 0;
		// The eye moves up a little: no card's view changes, so nothing uploads.
		batch.update([0, 0.01, 0]);
		expect(sprites.marks).toEqual([]);
		// The eye moves past the third card to its back: only that card turns.
		batch.update([0, 0, -20]);
		expect(sprites.marks).toEqual([[2, 1]]);
	});

	test('does nothing while the eye stays still, until markDirty', () => {
		const { batch, sprites } = batchOf([10, 0, 0]);
		batch.update([0, 0, 0]);
		sprites.marks.length = 0;
		// The card moves to the other side of the eye with no mark: the same eye skips the work.
		sprites.positions[0] = -10;
		batch.update([0, 0, 0]);
		expect(sprites.frames[0]).toBe(impostorFrame([-1, 0, 0], ATLAS));
		batch.markDirty(0, 1);
		batch.update([0, 0, 0]);
		expect(sprites.frames[0]).toBe(impostorFrame([1, 0, 0], ATLAS));
		expect(sprites.marks).toEqual([
			[0, 1],
			[0, 1],
		]);
	});

	test('joins changed cards close together into one range, and keeps far ones apart', () => {
		const count = 64;
		const positions = new Array<number>(count * 3).fill(0);
		// Every card starts in front of the eye; cards 0, 5 and 60 then sit east of it.
		for (let i = 0; i < count; i++) positions[i * 3 + 2] = -10;
		const { batch, sprites } = batchOf(positions);
		batch.update([0, 0, 0]);
		sprites.marks.length = 0;
		for (const i of [0, 5, 60]) {
			sprites.positions[i * 3] = 10;
			sprites.positions[i * 3 + 2] = 0;
		}
		batch.markDirty();
		sprites.marks.length = 0;
		batch.update([0, 0, 0]);
		expect(sprites.marks).toEqual([
			[0, 6],
			[60, 1],
		]);
	});
});

describe('createImpostors', () => {
	test('makes a static sprite batch with the origin, and fills the cards', async () => {
		const sprites = fakeSprites(2);
		let given: SpriteOptions | undefined;
		const scene = {
			async createSprites(options: SpriteOptions) {
				given = options;
				return sprites;
			},
		} as unknown as Scene;
		const batch = await createImpostors(scene, {
			texture: {} as Texture,
			atlas: ATLAS,
			positions: [1, 2, 3, 4, 5, 6],
			size: [2, 4],
			origin: [100, 0, 0],
		});
		expect(given?.dynamic).toBeFalsy();
		expect(given?.origin).toEqual([100, 0, 0]);
		expect(given?.center).toEqual([0.5, 0]);
		expect(Array.from(sprites.positions)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(Array.from(sprites.sizes)).toEqual([2, 4, 2, 4]);
		expect(batch.origin).toEqual([100, 0, 0]);
		expect(batch.count).toBe(2);
	});

	test('refuses positions that are not three numbers per card', async () => {
		const scene = {} as Scene;
		const options = { texture: {} as Texture, atlas: ATLAS, positions: [1, 2] };
		await expect(createImpostors(scene, options)).rejects.toThrow(RangeError);
	});
});
