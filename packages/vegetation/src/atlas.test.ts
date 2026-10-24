// The atlases' pixels and cells: that each leaf shape has a cell of its own, that a species picks
// the cell of its kind, that a cell holds several leaves which differ in colour, and that the
// painters make an atlas a material can use. Every pixel comes from integer hashes, so a test can
// compare two paintings of one atlas byte for byte.
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

/** The texels of one cell of a painted map, as the index of its four bytes. */
function cellTexels(width: number, index: number): number[] {
	const cellX = (index % LEAF_CELLS_X) * LEAF_CELL;
	const cellY = Math.floor(index / LEAF_CELLS_X) * LEAF_CELL;
	const texels: number[] = [];
	for (let y = 0; y < LEAF_CELL; y++)
		for (let x = 0; x < LEAF_CELL; x++) texels.push((cellY + y) * width + cellX + x);
	return texels;
}

/** The share of one cell that draws. */
function cellCoverage(surface: { width: number; data: Uint8Array }, index: number): number {
	let drawn = 0;
	for (const texel of cellTexels(surface.width, index))
		if ((surface.data[texel * 4 + 2] ?? 0) > 90) drawn += 1;
	return drawn / (LEAF_CELL * LEAF_CELL);
}

/** How many separate leaves one cell paints, each a patch of at least a leaf's worth of texels. */
function leafPatches(surface: { width: number; data: Uint8Array }, index: number): number {
	const drawn = new Uint8Array(LEAF_CELL * LEAF_CELL);
	const texels = cellTexels(surface.width, index);
	for (const [at, texel] of texels.entries())
		drawn[at] = (surface.data[texel * 4 + 2] ?? 0) > 90 ? 1 : 0;
	let patches = 0;
	const stack: number[] = [];
	for (let start = 0; start < drawn.length; start++) {
		if (!drawn[start]) continue;
		let area = 0;
		stack.push(start);
		drawn[start] = 0;
		while (stack.length > 0) {
			const at = stack.pop() as number;
			area += 1;
			const x = at % LEAF_CELL;
			const y = Math.floor(at / LEAF_CELL);
			const neighbours = [
				x > 0 ? at - 1 : -1,
				x < LEAF_CELL - 1 ? at + 1 : -1,
				y > 0 ? at - LEAF_CELL : -1,
				y < LEAF_CELL - 1 ? at + LEAF_CELL : -1,
			];
			for (const next of neighbours)
				if (next >= 0 && drawn[next]) {
					drawn[next] = 0;
					stack.push(next);
				}
		}
		if (area >= 30) patches += 1;
	}
	return patches;
}

/** The mean, the spread and the darkest texel of one cell's colour map. */
function colourSpread(
	color: { width: number; data: Uint8Array },
	surface: { width: number; data: Uint8Array },
	index: number,
): { mean: number; deviation: number; low: number } {
	let count = 0;
	let sum = 0;
	let squares = 0;
	let low = 255;
	for (const texel of cellTexels(color.width, index)) {
		if ((surface.data[texel * 4 + 2] ?? 0) < 200) continue;
		const green = color.data[texel * 4 + 1] ?? 0;
		count += 1;
		sum += green;
		squares += green * green;
		low = Math.min(low, green);
	}
	const mean = sum / Math.max(1, count);
	return {
		mean,
		deviation: Math.sqrt(Math.max(0, squares / Math.max(1, count) - mean * mean)),
		low,
	};
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
		const share = cellCoverage(surface, 0);
		expect(share).toBeGreaterThan(0.15);
		expect(share).toBeLessThan(0.75);
		// The card's own rim holds no leaf, so a card's edge draws nothing.
		const topLeft = surface.data[2] ?? 0;
		expect(topLeft).toBeLessThan(40);
	});

	it('draws several separate leaves in the cells of a cluster', () => {
		const surface = paintLeaf().surface;
		for (const index of [0, 1, 2, 3]) expect(leafPatches(surface, index)).toBeGreaterThan(3);
	});

	it('spreads the colour across the leaves of one cell', () => {
		const atlas = paintLeaf();
		for (const index of [0, 1, 2, 3]) {
			const spread = colourSpread(atlas.color, atlas.surface, index);
			// The colour map's values multiply the species' colour, so the leaves of a cell must
			// differ about white rather than paint one flat tone.
			expect(spread.mean).toBeGreaterThan(200);
			expect(spread.deviation).toBeGreaterThan(8);
			expect(spread.low).toBeLessThan(215);
		}
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
		for (let index = 0; index < LEAF_CELLS_X * LEAF_CELLS_Y; index++)
			shares.push(cellCoverage(surface, index));
		for (const share of shares) expect(share).toBeGreaterThan(0.05);
		// A needle spray and a frond cover less of a cell than a cluster does.
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
