// The atlases' pixels and cells: that each leaf shape has a cell of its own, that a species picks
// the cell of its kind, and that the painters make an atlas a material can use. Every pixel comes
// from integer hashes, so a test can compare two paintings of one atlas byte for byte.
import { describe, expect, it } from 'bun:test';
import { LEAF_CELLS_BY_KIND, leafCellFor } from './atlas';
import {
	BARK_SIZE,
	LEAF_CELL,
	LEAF_CELLS_X,
	LEAF_CELLS_Y,
	LEAF_HEIGHT,
	LEAF_WIDTH,
	paintBark,
	paintLeaf,
} from './atlas-pixels';
import { ALL_SPECIES, BUILTIN_SPECIES, CREEK_SPECIES } from './builtin';
import type { Species } from './species';

/** The share of a painted map's texels whose blue channel, its coverage, draws at all. */
function coverage(data: Uint8Array, from: number, to: number, channel: number): number {
	let drawn = 0;
	let total = 0;
	for (let at = from; at < to; at += 4) {
		total += 1;
		if ((data[at + channel] ?? 0) > 90) drawn += 1;
	}
	return total > 0 ? drawn / total : 0;
}

describe('the atlas blocks', () => {
	it('gives each leaf shape a cell of the leaf block', () => {
		const cells = Object.values(LEAF_CELLS_BY_KIND).map(([x, y]) => `${x},${y}`);
		expect(new Set(cells).size).toBe(cells.length);
		expect(cells.length).toBe(LEAF_CELLS_X * LEAF_CELLS_Y);
	});

	it('draws each species the cell of its own kind', () => {
		for (const species of ALL_SPECIES) {
			const cell = leafCellFor(species);
			const kind = species.leaf?.kind;
			if (kind === 'needle' || kind === 'frond' || kind === 'blade') expect(cell).toBe(kind);
			else if (kind === 'cluster') expect(cell.startsWith('cluster-')).toBe(true);
			else {
				const shape = species.rosette?.shape;
				expect(cell).toBe(shape === 'frond' ? 'frond' : shape === 'blade' ? 'blade' : 'broad');
			}
		}
	});

	it('spreads broadleaves over more than one cluster shape', () => {
		const shapes = new Set(
			CREEK_SPECIES.filter((species) => (species.leaf?.kind ?? 'cluster') === 'cluster').map(
				leafCellFor,
			),
		);
		expect(shapes.size).toBeGreaterThan(1);
	});

	it('holds the conifer and the rosettes', () => {
		const kinds = new Set(ALL_SPECIES.map((species) => leafCellFor(species)));
		expect(kinds.has('needle')).toBe(true);
		expect(kinds.has('blade')).toBe(true);
		expect(kinds.has('frond')).toBe(true);
		expect(kinds.has('broad')).toBe(true);
		// A species without leaves draws a cluster cell all the same, so no draw samples nothing.
		const bare: Species = {
			...(BUILTIN_SPECIES[0] as Species),
			leaf: undefined,
			rosette: undefined,
		};
		expect(leafCellFor(bare).startsWith('cluster-')).toBe(true);
	});

	it('keeps the sizes the painters fill', () => {
		const bark = paintBark().color;
		expect(bark.width).toBe(BARK_SIZE);
		expect(bark.height).toBe(BARK_SIZE);
		expect(bark.data.length).toBe(BARK_SIZE * BARK_SIZE * 4);
		const leaf = paintLeaf().color;
		expect(leaf.width).toBe(LEAF_WIDTH);
		expect(leaf.height).toBe(LEAF_HEIGHT);
		expect(leaf.data.length).toBe(LEAF_WIDTH * LEAF_HEIGHT * 4);
		expect(LEAF_WIDTH).toBe(LEAF_CELLS_X * LEAF_CELL);
	});
});

describe('the painted leaves', () => {
	it('covers about half of a cluster cell, and nothing at its rim', () => {
		const surface = paintLeaf().surface;
		const cell = LEAF_CELL * LEAF_CELL * 4;
		const share = coverage(surface.data, 0, cell, 2);
		expect(share).toBeGreaterThan(0.15);
		expect(share).toBeLessThan(0.75);
		// The card's own rim holds no leaf, so a card's edge draws nothing.
		const topLeft = surface.data[2] ?? 0;
		expect(topLeft).toBeLessThan(40);
	});

	it('writes a normal that points out of the leaf', () => {
		const surface = paintLeaf().surface;
		let inside = 0;
		let forward = 0;
		for (let at = 0; at < LEAF_CELL * LEAF_CELL * 4; at += 4) {
			if ((surface.data[at + 2] ?? 0) < 200) continue;
			inside += 1;
			// A flat leaf points the normal straight out of the card, which is (0.5, 0.5) remapped.
			const nx = (surface.data[at] ?? 128) / 255 - 0.5;
			const ny = (surface.data[at + 1] ?? 128) / 255 - 0.5;
			if (Math.abs(nx) < 0.4 && Math.abs(ny) < 0.4) forward += 1;
		}
		expect(inside).toBeGreaterThan(0);
		expect(forward / inside).toBeGreaterThan(0.6);
	});

	it('paints the same atlas twice, byte for byte', () => {
		expect(paintLeaf().color.data).toEqual(paintLeaf().color.data);
		expect(paintBark().color.data).toEqual(paintBark().color.data);
	});

	it('gives each of the eight cells leaves of its own', () => {
		const surface = paintLeaf().surface;
		const shares: number[] = [];
		const cell = LEAF_CELL * LEAF_CELL * 4;
		for (let index = 0; index < LEAF_CELLS_X * LEAF_CELLS_Y; index++)
			shares.push(coverage(surface.data, index * cell, (index + 1) * cell, 2));
		for (const share of shares) expect(share).toBeGreaterThan(0.05);
		// A needle spray and a blade cover less of a cell than a cluster does.
		expect(Math.max(...shares)).toBeGreaterThan(Math.min(...shares) * 1.2);
	});
});

describe('the painted bark', () => {
	it('paints plates that tile', () => {
		const color = paintBark().color;
		// The block tiles, so its opposite edges agree more closely than two random texels do.
		const at = (x: number, y: number) => color.data[(y * BARK_SIZE + x) * 4] ?? 0;
		let edge = 0;
		let middle = 0;
		for (let y = 0; y < BARK_SIZE; y += 4) {
			edge += Math.abs(at(0, y) - at(BARK_SIZE - 1, y));
			middle += Math.abs(at(0, y) - at(BARK_SIZE / 2, y));
		}
		expect(edge).toBeLessThan(middle);
	});

	it('bends the normal along the plates', () => {
		const surface = paintBark().surface;
		let bent = 0;
		let total = 0;
		for (let at = 0; at < surface.data.length; at += 4) {
			total += 1;
			const nx = (surface.data[at] ?? 128) / 255 - 0.5;
			if (Math.abs(nx) > 0.02) bent += 1;
		}
		expect(bent / total).toBeGreaterThan(0.3);
	});
});
