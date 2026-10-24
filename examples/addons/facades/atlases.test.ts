// The facades atlases are made in code, so a unit test checks their output alone: their sizes, the
// window's mask and light, that the four wall finishes differ, and that a window code holds every
// room value in its own range. The test imports no engine code.

import { describe, expect, test } from 'bun:test';
import {
	ATLAS_SIZE,
	buildCodeAtlas,
	buildWallAtlas,
	CODE_SIZE,
	FACADE_KINDS,
	hashCode,
	TILE,
	TILES,
} from './atlases';

/** A window in the middle of a cell, with a frame's band on each side. */
const GLASS = { x0: 0.22, y0: 0.18, x1: 0.78, y1: 0.82 };

/** The RGBA texel of a page at (x, y), counting from the page's bottom left. */
function texel(data: Uint8Array, size: number, x: number, y: number): number[] {
	const at = (y * size + x) * 4;
	return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0, data[at + 3] ?? 0];
}

describe('the wall atlas', () => {
	test('holds four tiles of one wall finish each', () => {
		const atlas = buildWallAtlas(GLASS);
		expect(atlas.size).toBe(ATLAS_SIZE);
		expect(ATLAS_SIZE).toBe(TILE * TILES);
		expect(atlas.color.length).toBe(ATLAS_SIZE * ATLAS_SIZE * 4);
		expect(atlas.orm.length).toBe(atlas.color.length);
	});

	test('marks the window glass in the alpha channel alone', () => {
		const atlas = buildWallAtlas(GLASS);
		let glass = 0;
		for (let y = 0; y < TILE; y++)
			for (let x = 0; x < TILE; x++) {
				const u = (x + 0.5) / TILE;
				const v = (y + 0.5) / TILE;
				const inside = u > GLASS.x0 && u < GLASS.x1 && v > GLASS.y0 && v < GLASS.y1;
				// Every tile carries the same window.
				for (let t = 0; t < TILES * TILES; t++) {
					const tx = (t % TILES) * TILE + x;
					const ty = Math.floor(t / TILES) * TILE + y;
					const [r, g, b, a] = texel(atlas.color, ATLAS_SIZE, tx, ty) as [
						number,
						number,
						number,
						number,
					];
					expect(a).toBe(inside ? 255 : 0);
					if (inside) {
						glass++;
						expect(r + g + b).toBeGreaterThan(0);
					}
				}
			}
		// The window covers about a third of a cell, so the far fallback has a fair mask.
		const share = glass / (TILES * TILES * TILE * TILE);
		expect(share).toBeGreaterThan(0.2);
		expect(share).toBeLessThan(0.55);
	});

	test('gives each finish its own wall', () => {
		const atlas = buildWallAtlas(GLASS);
		// A texel of the wall above the window, in each of the four tiles.
		const x = Math.floor(TILE * 0.5);
		const y = Math.floor(TILE * 0.95);
		const walls = FACADE_KINDS.map((_, t) => {
			const tx = (t % TILES) * TILE + x;
			const ty = Math.floor(t / TILES) * TILE + y;
			return texel(atlas.color, ATLAS_SIZE, tx, ty).slice(0, 3).join(',');
		});
		expect(new Set(walls).size).toBe(FACADE_KINDS.length);
	});

	test('paints a sill under the window brighter than the frame above it', () => {
		const atlas = buildWallAtlas(GLASS);
		const x = Math.floor(TILE * 0.5);
		// The band just under the opening is the sill; the band just over it is the frame.
		const sillY = Math.floor(TILE * (GLASS.y0 - 0.015));
		const frameY = Math.floor(TILE * (GLASS.y1 + 0.015));
		const sill = texel(atlas.color, ATLAS_SIZE, x, sillY) as [number, number, number];
		const frame = texel(atlas.color, ATLAS_SIZE, x, frameY) as [number, number, number];
		expect(sill[0] + sill[1] + sill[2]).toBeGreaterThan(frame[0] + frame[1] + frame[2]);
	});

	test('is the same on every run', () => {
		expect(buildWallAtlas(GLASS).color).toEqual(buildWallAtlas(GLASS).color);
		expect(hashCode(3, 7, 11)).toBe(hashCode(3, 7, 11));
	});
});

describe('the window code atlas', () => {
	test('holds one code for each room', () => {
		const atlas = buildCodeAtlas();
		expect(atlas.size).toBe(CODE_SIZE);
		expect(atlas.data.length).toBe(CODE_SIZE * CODE_SIZE * 4);
	});

	test('keeps every room value in its own range', () => {
		const atlas = buildCodeAtlas();
		let blinds = 0;
		let furniture = 0;
		for (let i = 0; i < CODE_SIZE * CODE_SIZE; i++) {
			const warmth = atlas.data[i * 4] as number;
			const level = atlas.data[i * 4 + 1] as number;
			const blind = atlas.data[i * 4 + 2] as number;
			const furnishing = atlas.data[i * 4 + 3] as number;
			// A level never falls to a room with no light at all, and never leaves its range.
			expect(level).toBeGreaterThanOrEqual(89);
			if (blind > 0) {
				blinds++;
				expect(blind).toBeGreaterThanOrEqual(76);
			}
			if (furnishing > 76) furniture++;
			expect(warmth).toBeGreaterThanOrEqual(0);
			expect(warmth).toBeLessThanOrEqual(255);
		}
		// Rooms differ: some rooms have blinds and some have furniture.
		expect(blinds).toBeGreaterThan(CODE_SIZE);
		expect(furniture).toBeGreaterThan(CODE_SIZE);
	});

	test('gives neighbouring codes unrelated rooms', () => {
		const atlas = buildCodeAtlas();
		const warmth = (x: number, y: number): number => atlas.data[(y * CODE_SIZE + x) * 4] as number;
		const neighbours = [
			Math.abs(warmth(0, 0) - warmth(1, 0)),
			Math.abs(warmth(0, 0) - warmth(0, 1)),
			Math.abs(warmth(4, 4) - warmth(5, 4)),
		];
		for (const step of neighbours) expect(step).toBeGreaterThan(8);
	});
});
