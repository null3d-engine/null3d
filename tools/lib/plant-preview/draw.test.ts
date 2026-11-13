// The preview's cards as the plant's material draws them: each triangle at its own mip level, the
// face it shows, the cell's own cut, and a matte that takes only the texels the colour picture keeps.
// Each test draws flat square cards of a uniform atlas, square to a camera without perspective.
import { describe, expect, test } from 'bun:test';
import type { PlantAsset, SpeciesKitData } from '../../../packages/vegetation/src/asset.ts';
import type { PreviewCamera } from './camera.ts';
import { COVER_LEAF, COVER_NONE, canvas, cardFootprint, drawCards } from './draw.ts';

/** The atlas's texels a side. */
const SIZE = 64;
/** The box the cards' positions are quantised in, in metres. */
const BOX = { min: [-2, -2, -2], max: [2, 2, 2] } as const;
/** The canvas's pixels a side, and its middle pixel. */
const SIDE = 96;
const MIDDLE = (SIDE / 2) * SIDE + SIDE / 2;

/** A kit whose card atlas holds one coverage in each layer and one cut fall, as a byte. */
function kitOf(front: number, back: number, fallByte = 0): SpeciesKitData {
	const color = new Uint8Array(SIZE * SIZE * 8);
	const surface = new Uint8Array(SIZE * SIZE * 8);
	for (let layer = 0; layer < 2; layer++)
		for (let i = 0; i < SIZE * SIZE; i++) {
			color[(layer * SIZE * SIZE + i) * 4 + 3] = Math.round((layer === 0 ? front : back) * 255);
			surface[(layer * SIZE * SIZE + i) * 4 + 2] = fallByte;
		}
	return { box: BOX, cards: { size: SIZE, color, surface } } as unknown as SpeciesKitData;
}

/**
 * A card level of square cards two metres a side in the plane facing +Z, at the depths given, each
 * reading the whole atlas; wound counter-clockwise toward +Z, or the other way when `back`.
 */
function levelOf(depths: readonly number[], back = false): PlantAsset {
	const q = (value: number, k: number) =>
		Math.round(
			((value - (BOX.min[k] as number)) / ((BOX.max[k] as number) - (BOX.min[k] as number))) *
				65535,
		);
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (const z of depths) {
		const first = positions.length / 3;
		for (const [x, y, u, v] of [
			[-1, -1, 0, 1],
			[1, -1, 1, 1],
			[1, 1, 1, 0],
			[-1, 1, 0, 0],
		] as const) {
			positions.push(q(x, 0), q(y, 1), q(z, 2));
			uvs.push(u * 65535, v * 65535);
		}
		indices.push(
			...(back ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]).map((corner) => first + corner),
		);
	}
	const count = positions.length / 3;
	const cards = {
		name: 'cards',
		arrays: {
			positions: new Uint16Array(positions),
			normals: new Int8Array(count * 3),
			uvs: new Uint16Array(uvs),
			uvs1: new Uint16Array(count * 2),
			colors: new Uint8Array(count * 4).fill(100),
			indices: new Uint16Array(indices),
		},
	};
	return { levels: [{ parts: [] }, { parts: [cards] }, { parts: [] }] } as unknown as PlantAsset;
}

/** A camera without perspective on +Z, looking down -Z, at `scale` pixels a metre. */
function cameraAt(scale: number): PreviewCamera {
	return {
		width: SIDE,
		height: SIDE,
		position: [0, 0, 10],
		right: [1, 0, 0],
		up: [0, 1, 0],
		forward: [0, 0, -1],
		focal: 0,
		scale,
	};
}

/** The middle pixel's clear share and cover after drawing a level's cards; the still is the canvas. */
function drawn(kit: SpeciesKitData, asset: PlantAsset, scale: number) {
	const into = canvas(SIDE, SIDE);
	drawCards(into, cameraAt(scale), kit, asset, 1, SIDE);
	return { clear: into.clear[MIDDLE] as number, cover: into.cover[MIDDLE] as number };
}

describe("a card triangle's footprint", () => {
	const uvs = [0, 0, 65535, 0, 65535, 65535];
	test('reads the mip level of the texels a pixel spans, and the back of a clockwise triangle', () => {
		// 64 texels over 16 pixels: four a pixel, level 2. The rows count down, so this triangle runs
		// clockwise on the screen and shows its back.
		const read = cardFootprint([0, 0, 0, 16, 0, 0, 16, 16, 0], uvs, 0, 1, 2, SIZE, 1);
		expect(read.level).toBeCloseTo(2, 6);
		expect(read.back).toBe(true);
		expect(cardFootprint([0, 0, 0, 16, 16, 0, 16, 0, 0], uvs, 0, 1, 2, SIZE, 1).back).toBe(false);
	});

	test('takes the longer axis of a slanted card', () => {
		// Four texels a pixel across, sixteen down: the level is the longer axis's, 4.
		const read = cardFootprint([0, 0, 0, 16, 0, 0, 16, 4, 0], uvs, 0, 1, 2, SIZE, 1);
		expect(read.level).toBeCloseTo(4, 6);
	});
});

describe("the preview's cards", () => {
	test('keep a texel by the cut, and the matte takes its coverage only where the colour keeps it', () => {
		// 64 texels over 64 pixels: the full-size level.
		const faint = drawn(kitOf(0.3, 0.3), levelOf([0]), 32);
		expect(faint.clear).toBe(1);
		expect(faint.cover).toBe(COVER_NONE);
		const dense = drawn(kitOf(0.8, 0.8), levelOf([0]), 32);
		expect(dense.clear).toBeCloseTo(1 - 0.8, 2);
		expect(dense.cover).toBe(COVER_LEAF);
	});

	test('add no matte cover from faint cards over one another', () => {
		// Two cards at 0.3 would leave 0.49 of the pixel clear if each added its soft cover.
		expect(drawn(kitOf(0.3, 0.3), levelOf([0, 0.5]), 32).clear).toBe(1);
	});

	test("keep a faint texel at a coarser level by the cell's own fall", () => {
		// 64 texels over 32 pixels: level 1. A full fall, 0.3 a level, lowers the cut to 0.2, so a
		// texel of 0.4 draws and the matte takes it raised by the level's lift; with no fall it does not.
		const kept = drawn(kitOf(0.4, 0.4, 255), levelOf([0]), 16);
		expect(kept.cover).toBe(COVER_LEAF);
		expect(kept.clear).toBeCloseTo(1 - 0.4 * 1.05, 2);
		expect(drawn(kitOf(0.4, 0.4, 0), levelOf([0]), 16).cover).toBe(COVER_NONE);
	});

	test("read the atlas's back layer where a card's back faces the camera", () => {
		expect(drawn(kitOf(0, 1), levelOf([0], true), 32).cover).toBe(COVER_LEAF);
		expect(drawn(kitOf(0, 1), levelOf([0]), 32).cover).toBe(COVER_NONE);
	});
});
