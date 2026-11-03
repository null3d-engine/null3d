// The atlases' pixels and cells: that each leaf shape has a cell of its own, that a species picks
// the cell of its kind, that a cell fills with leaves which differ in colour, and that the painters
// make an atlas a material can use. Every pixel comes from integer hashes, so a test can compare two
// paintings of one atlas byte for byte.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { barkCellFor, LEAF_CELLS_BY_KIND, leafCellFor } from './atlas';
import {
	BARK_CELLS_X,
	BARK_HEIGHT,
	BARK_SIZE,
	BARK_WIDTH,
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

	it('names a cell for every built-in species rather than hashing one', () => {
		for (const species of ALL_SPECIES)
			if (species.leaf?.kind === 'cluster') expect(species.leaf.cell).toBeDefined();
	});

	it('names a bark cell for every built-in branch plant', () => {
		for (const species of ALL_SPECIES)
			if (species.kind === 'tree' || species.kind === 'conifer' || species.kind === 'shrub')
				expect(species.bark).toBeDefined();
	});

	it('gives a species its own bark cell, or the smooth one', () => {
		const oak = ALL_SPECIES.find((species) => species.id === 'oak') as Species;
		expect(barkCellFor(oak)).toBe('oak');
		expect(barkCellFor({ ...oak, bark: undefined })).toBe('beech');
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

	it('keeps the cell that a record names', () => {
		const base = BUILTIN_SPECIES[0] as Species;
		const leaf = base.leaf as NonNullable<Species['leaf']>;
		expect(leafCellFor({ ...base, leaf: { ...leaf, cell: 'cluster-d' } })).toBe('cluster-d');
		expect(leafCellFor({ ...base, leaf: { ...leaf, cell: 'needle' } })).toBe('needle');
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
		expect(bark.width).toBe(BARK_WIDTH);
		expect(bark.height).toBe(BARK_HEIGHT);
		expect(bark.data.length).toBe(BARK_WIDTH * BARK_HEIGHT * 4);
		expect(BARK_WIDTH).toBe(BARK_CELLS_X * BARK_SIZE);
		const leaf = paintLeaf().color;
		expect(leaf.width).toBe(LEAF_WIDTH);
		expect(leaf.height).toBe(LEAF_HEIGHT);
		expect(leaf.data.length).toBe(LEAF_WIDTH * LEAF_HEIGHT * 4);
		expect(LEAF_WIDTH).toBe(LEAF_CELLS_X * LEAF_CELL);
	});
});

describe('the painted leaves', () => {
	it('fills most of a cluster cell with leaves, and nothing at its rim', () => {
		const surface = paintLeaf().surface;
		const share = cellCoverage(surface, 0);
		// A card that shows leaves over much less of its square reads as a bunch, with sky between one
		// card and the next. One that covers all of it is a slab with no leaf edge at all.
		expect(share).toBeGreaterThan(0.35);
		expect(share).toBeLessThan(0.8);
		// The card's own rim holds no leaf, so a card's edge draws nothing.
		const topLeft = surface.data[2] ?? 0;
		expect(topLeft).toBeLessThan(40);
	});

	it('covers every cluster cell, as a painted card does', () => {
		const surface = paintLeaf().surface;
		for (const index of [0, 1, 2, 3]) {
			const share = cellCoverage(surface, index);
			expect(share).toBeGreaterThan(0.35);
			expect(share).toBeLessThan(0.8);
		}
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

	it('varies a leaf brightness without a hue of its own', () => {
		const atlas = paintLeaf();
		const sums = [0, 0, 0];
		let covered = 0;
		for (let at = 0; at < atlas.color.data.length; at += 4) {
			if ((atlas.surface.data[at + 2] ?? 0) < 200) continue;
			for (let channel = 0; channel < 3; channel++)
				sums[channel] = (sums[channel] as number) + (atlas.color.data[at + channel] as number);
			covered += 1;
		}
		expect(covered).toBeGreaterThan(1000);
		const means = sums.map((sum) => (sum as number) / covered);
		// The colour map multiplies the species' colour, so its leaves average neutral: no channel
		// may sit above the others, or a blue leaf would vary toward a green one.
		expect(Math.abs((means[0] as number) - (means[1] as number))).toBeLessThan(3);
		expect(Math.abs((means[1] as number) - (means[2] as number))).toBeLessThan(3);
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
		// A cell may hold a sparse shoot: a pine's fascicles are thin needles on bare twig, so the
		// floor asks that a cell holds leaves at all, not that it is full.
		for (const share of shares) expect(share).toBeGreaterThan(0.02);
		// A needle spray and a frond cover less of a cell than a cluster does.
		expect(Math.max(...shares)).toBeGreaterThan(Math.min(...shares) * 1.2);
	});
});

describe('the painted bark', () => {
	it('paints plates that tile', () => {
		const color = paintBark().color;
		// The block tiles, so its opposite edges agree more closely than two random texels do.
		// Each cell tiles within itself, so a cell's opposite edges agree more closely than two
		// random texels of it do. The first cell is the birch's bark.
		const at = (x: number, y: number) => color.data[(y * BARK_WIDTH + x) * 4] ?? 0;
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
		// The smooth families bend less than the plated ones, so the block as a whole is a little
		// flatter than the one bark it used to hold.
		expect(bent / total).toBeGreaterThan(0.25);
	});
});

describe('the plant shaders', () => {
	it('draw one surface function in both files', () => {
		// The card-tree material adds the vertex offset to the plain plant shader's surface. The
		// shader compiler joins a file whole, so the surface is a copy, and this test holds the two
		// copies equal.
		const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
		const from = 'fn surface(input: SurfaceInput) -> Surface {';
		const surface = (source: string) => source.slice(source.indexOf(from));
		expect(surface(read('./plant-cards.wgsl'))).toContain(from);
		expect(surface(read('./plant-cards.wgsl'))).toBe(surface(read('./plant.wgsl')));
	});

	it('read the wind with one offset in both files', () => {
		// The card material adds only the level morph to the plant shader, so the branch records, the
		// turns and the wind offset are copies, and this test holds them equal.
		const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
		const from = '/// One turn,';
		const to = '/// Moves each vertex by the wind';
		const shared = (source: string) => source.slice(source.indexOf(from), source.indexOf(to));
		const plain = shared(read('./plant.wgsl'));
		expect(plain).toContain('fn wind_offset');
		expect(shared(read('./plant-cards.wgsl'))).toBe(plain);
	});
	it('read the wind field with one copy in the plant and grass shaders', () => {
		// The grass copies the field's steady settings and its sampling function from the plant
		// shader, so a change to the air rules in one file must reach the other. Two test pages draw
		// readers too: the cost page carries both blocks, and the gust page carries the steady block
		// twice and keeps only the reading function of the other, so it is held to the steady block
		// alone.
		const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
		const block = (source: string, name: string) => {
			const from = `// <${name}>`;
			const to = `// </${name}>`;
			return source.slice(source.indexOf(from), source.indexOf(to));
		};
		const COST_PAGE = '../../../../tests/pages/sketches/wind-reader-cost-sketch.ts';
		const GUST_PAGE = '../../../../tests/pages/sketches/gust-crossing-sketch.ts';
		for (const name of ['wind-steady', 'wind-sample']) {
			const plant = block(read('./plant.wgsl'), name);
			expect(plant.length).toBeGreaterThan(0);
			for (const file of [
				'../grass/grass.wgsl',
				'../floating-leaves/floating-leaves.wgsl',
				'../floating-leaves/floating-leaves-state.wgsl',
				'../floating-leaves/floating-leaves-state.fallback.wgsl',
				COST_PAGE,
				...(name === 'wind-steady' ? [GUST_PAGE] : []),
			])
				expect(block(read(file), name)).toBe(plant);
		}
		// The gust page draws the steady block twice, once for each path's form.
		const gust = read(GUST_PAGE);
		const steady = block(read('./plant.wgsl'), 'wind-steady');
		const copies = gust.split('// <wind-steady>').length - 1;
		expect(copies).toBe(2);
		for (const piece of gust.split('// <wind-steady>').slice(1))
			expect(`// <wind-steady>${piece.slice(0, steady.length - '// <wind-steady>'.length)}`).toBe(
				steady,
			);
	});
});
