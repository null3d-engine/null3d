// The waterfall's sheet: it starts at the lip's height and width, follows the path of falling
// water, never rises, widens as it falls and looks out from the cliff. The shader reads the veil
// from the mesh's second texture coordinate, so the two keep one layout. The spray's emitters stand
// at the brink, on the path and at the foot, turned across the fall.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	APRON,
	APRON_LIFT,
	EDGE_ROOM,
	FALL_SPEED,
	type FallSheet,
	fallEmitters,
	fallPlace,
	fallSheet,
	fallTime,
	GRAVITY,
	MIST_DEPTH,
	MIST_OUT,
	MIST_WIDTH,
	SHEET_VEIL,
	SIDE_SLOWING,
	VEIL_ROOM,
	VEILS,
	veilBow,
} from './fall';

const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');

/** A creek 5 m wide that falls 20 m off a lip at (10, -4), running along +x. */
const SHEET: FallSheet = {
	lip: [10, -4],
	direction: [2, 0],
	halfWidth: 2.5,
	level: 1.5,
	speed: 1.4,
	drop: 20,
	spread: 0.1,
	mesh: { across: 8, down: 24 },
};

/** The mesh's arrays with their types. */
function meshOf(sheet: FallSheet) {
	const mesh = fallSheet(sheet);
	return {
		positions: mesh.positions as Float32Array,
		normals: mesh.normals as Float32Array,
		uvs: mesh.uvs as Float32Array,
		uvs1: mesh.uvs1 as Float32Array,
		indices: mesh.indices as Uint32Array,
	};
}

/** The veil of each vertex, and its place across from -1 to 1, as the shader reads them. */
function veilOf(uvs1: Float32Array, vertex: number): { veil: number; across: number } {
	const x = uvs1[vertex * 2] as number;
	const veil = Math.floor(x / VEIL_ROOM);
	return { veil, across: (x - VEIL_ROOM * veil) * 2 - 1 };
}

/** The vertices of one veil, as rows from the top, each row from one end of the lip to the other. */
function rowsOf(sheet: FallSheet, veil: number): number[][] {
	const { uvs, uvs1 } = meshOf(sheet);
	const columns = (sheet.mesh?.across as number) + 1;
	const rows: number[][] = [];
	for (let v = 0; v < uvs.length / 2; v++) {
		if (veilOf(uvs1, v).veil !== veil) continue;
		const last = rows[rows.length - 1];
		if (!last || last.length === columns) rows.push([v]);
		else last.push(v);
	}
	return rows;
}

describe('the path of falling water', () => {
	it('leaves the lip level, with the current, and gains speed as it falls', () => {
		const at: [number, number] = [0, 0];
		fallPlace(0, 1.4, at);
		expect(at).toEqual([0, 0]);
		fallPlace(0.01, 1.4, at);
		// Over the first instant the water moves out at the current and has barely fallen.
		expect(at[0]).toBeCloseTo(0.014, 3);
		expect(at[1]).toBeCloseTo(0.5 * GRAVITY * 0.01 * 0.01, 4);
		let last = 0;
		let lastStep = 0;
		for (let t = 0.1; t < 6; t += 0.1) {
			fallPlace(t, 1.4, at);
			const step = at[1] - last;
			expect(step).toBeGreaterThan(lastStep);
			// The air slows it toward its steady speed, never past it.
			expect(step).toBeLessThan(FALL_SPEED * 0.1 + 1e-9);
			last = at[1];
			lastStep = step;
		}
	});

	it('curves over at the lip, then drops almost straight', () => {
		const at: [number, number] = [0, 0];
		/** How far the water moves out for each meter that it falls, between two times. */
		const slope = (from: number, to: number) => {
			fallPlace(from, 1.4, at);
			const [out, fallen] = at;
			fallPlace(to, 1.4, at);
			return (at[0] - out) / (at[1] - fallen);
		};
		expect(slope(0, 0.2)).toBeGreaterThan(1);
		expect(slope(1, 2)).toBeLessThan(0.1);
		expect(slope(2, 3)).toBeLessThan(0.03);
		// The air stops it moving out past the current's speed times the drag's time.
		fallPlace(30, 1.4, at);
		expect(at[0]).toBeLessThan((1.4 * FALL_SPEED) / GRAVITY + 1e-9);
	});

	it('runs on the river before the lip', () => {
		const at: [number, number] = [0, 0];
		fallPlace(-0.5, 1.4, at);
		expect(at).toEqual([-0.7, 0]);
	});

	it('takes the time to fall a drop that the path gives back', () => {
		const at: [number, number] = [0, 0];
		for (const drop of [0.5, 13, 20, 60, 400]) {
			fallPlace(fallTime(drop), 1, at);
			expect(at[1]).toBeCloseTo(drop, 6);
		}
		expect(fallTime(0)).toBe(0);
	});
});

describe('a waterfall’s sheet', () => {
	it('starts at the lip’s height, across the lip’s width', () => {
		const { positions, uvs } = meshOf(SHEET);
		const front = rowsOf(SHEET, SHEET_VEIL);
		// The row where the water crosses the lip: the first whose time is not negative.
		const lipRow = front.find(
			(row) => (uvs[(row[0] as number) * 2 + 1] as number) >= 0,
		) as number[];
		expect(uvs[(lipRow[0] as number) * 2 + 1]).toBe(0);
		for (const v of lipRow) {
			expect(positions[v * 3] as number).toBeCloseTo(10, 5);
			expect(positions[v * 3 + 1] as number).toBeCloseTo(SHEET.level + APRON_LIFT, 5);
		}
		// The mesh reaches past the water's edges, where the material tears them; the water's own
		// edges lie at the lip's half width, which the first texture coordinate names.
		const zs = lipRow.map((v) => positions[v * 3 + 2] as number);
		expect(Math.min(...zs)).toBeCloseTo(-4 - SHEET.halfWidth * EDGE_ROOM, 5);
		expect(Math.max(...zs)).toBeCloseTo(-4 + SHEET.halfWidth * EDGE_ROOM, 5);
		const lips = lipRow.map((v) => uvs[v * 2] as number);
		expect(Math.min(...lips) / EDGE_ROOM).toBeCloseTo(-SHEET.halfWidth, 5);
		expect(Math.max(...lips) / EDGE_ROOM).toBeCloseTo(SHEET.halfWidth, 5);
	});

	it('lies on the river’s surface upstream of the lip, over the apron', () => {
		const { positions, uvs } = meshOf(SHEET);
		const front = rowsOf(SHEET, SHEET_VEIL);
		const top = front[0] as number[];
		expect(uvs[(top[0] as number) * 2 + 1] as number).toBeCloseTo(-APRON / SHEET.speed, 5);
		for (const v of top) {
			expect(positions[v * 3] as number).toBeLessThan(10 - APRON * (1 - SIDE_SLOWING) + 1e-4);
			expect(positions[v * 3 + 1] as number).toBeCloseTo(SHEET.level + APRON_LIFT, 5);
		}
	});

	it('follows the path of falling water in every veil', () => {
		const { positions, uvs, uvs1 } = meshOf(SHEET);
		const at: [number, number] = [0, 0];
		for (let v = 0; v < positions.length / 3; v++) {
			const { veil, across } = veilOf(uvs1, v);
			const own =
				SHEET.speed * (VEILS[veil]?.speed as number) * (1 - SIDE_SLOWING * across * across);
			const t = uvs[v * 2 + 1] as number;
			// The apron runs at the lip's middle speed, and each veil's water at its own after the lip.
			fallPlace(t, t <= 0 ? SHEET.speed * (1 - SIDE_SLOWING * across * across) : own, at);
			const shape = VEILS[veil] as (typeof VEILS)[number];
			const water = (SHEET.halfWidth + SHEET.spread * at[1]) * shape.width;
			const half = water * EDGE_ROOM;
			const bow = veilBow(shape.depth, water, across * EDGE_ROOM, at[1]);
			expect(positions[v * 3] as number).toBeCloseTo(10 + at[0] + bow, 3);
			expect(positions[v * 3 + 1] as number).toBeCloseTo(SHEET.level + APRON_LIFT - at[1], 3);
			expect(positions[v * 3 + 2] as number).toBeCloseTo(-4 + across * half, 3);
			expect(uvs1[v * 2 + 1] as number).toBeCloseTo(at[1], 3);
		}
	});

	it('never rises, and reaches the drop at its foot', () => {
		const { positions } = meshOf(SHEET);
		for (let veil = 0; veil < VEILS.length; veil++) {
			const rows = rowsOf(SHEET, veil);
			for (let column = 0; column < (rows[0] as number[]).length; column++) {
				let last = Number.POSITIVE_INFINITY;
				for (const row of rows) {
					const y = positions[(row[column] as number) * 3 + 1] as number;
					expect(y).toBeLessThanOrEqual(last);
					last = y;
				}
				expect(last).toBeCloseTo(SHEET.level + APRON_LIFT - SHEET.drop, 3);
			}
		}
	});

	it('widens as it falls', () => {
		const { positions } = meshOf(SHEET);
		const front = rowsOf(SHEET, SHEET_VEIL);
		const width = (row: number[]) =>
			(positions[(row[row.length - 1] as number) * 3 + 2] as number) -
			(positions[(row[0] as number) * 3 + 2] as number);
		let last = 0;
		for (const row of front) {
			expect(width(row)).toBeGreaterThanOrEqual(last - 1e-5);
			last = width(row);
		}
		expect(last).toBeCloseTo(2 * (SHEET.halfWidth + SHEET.spread * SHEET.drop) * EDGE_ROOM, 3);
	});

	it('stands as a column as deep as the creek is wide, seen from the side', () => {
		const { positions } = meshOf(SHEET);
		const middle = (SHEET.mesh?.across as number) / 2;
		const foot = (veil: number) => {
			const rows = rowsOf(SHEET, veil);
			return rows[rows.length - 1] as number[];
		};
		const out = (veil: number, column: number) =>
			(positions[(foot(veil)[column] as number) * 3] as number) - 10;
		const water = SHEET.halfWidth + SHEET.spread * SHEET.drop;
		// From the side the column runs from the back veil's middle to the front veil's.
		expect(out(VEILS.length - 1, middle) - out(0, middle)).toBeGreaterThan(2 * SHEET.halfWidth);
		// Each veil bows: its middle stands further out than the water's edges, and the arch grows
		// from nothing at the lip.
		const edge = Math.round(middle * (1 - 1 / EDGE_ROOM));
		for (let veil = SHEET_VEIL; veil < VEILS.length; veil++)
			expect(out(veil, middle)).toBeGreaterThan(out(veil, edge) + water * 0.3);
		expect(veilBow(1, 2, 0, 0)).toBe(0);
		expect(veilBow(1, 2, 0, 30)).toBeCloseTo(2, 6);
	});

	it('hangs its back veil behind the sheet, toward the cliff, and its front veil in front', () => {
		const { positions } = meshOf(SHEET);
		const back = rowsOf(SHEET, 0);
		const front = rowsOf(SHEET, SHEET_VEIL);
		const middle = (SHEET.mesh?.across as number) / 2;
		const out = (row: number[]) => (positions[(row[middle] as number) * 3] as number) - 10;
		const foot = (rows: number[][]) => rows[rows.length - 1] as number[];
		const spray = rowsOf(SHEET, VEILS.length - 1);
		expect(out(foot(back))).toBeLessThan(out(foot(front)));
		expect(out(foot(back))).toBeGreaterThan(0);
		expect(out(foot(spray))).toBeGreaterThan(out(foot(front)));
	});

	it('looks out from the cliff, on every triangle and every vertex', () => {
		const { positions, normals, indices } = meshOf(SHEET);
		const corner = (index: number) =>
			[0, 1, 2].map((axis) => positions[(indices[index] as number) * 3 + axis] as number);
		for (let k = 0; k < indices.length; k += 3) {
			const [a, b, c] = [corner(k), corner(k + 1), corner(k + 2)] as number[][];
			const u = (a as number[]).map((value, axis) => ((b as number[])[axis] as number) - value);
			const w = (a as number[]).map((value, axis) => ((c as number[])[axis] as number) - value);
			const n = [
				(u[1] as number) * (w[2] as number) - (u[2] as number) * (w[1] as number),
				(u[2] as number) * (w[0] as number) - (u[0] as number) * (w[2] as number),
				(u[0] as number) * (w[1] as number) - (u[1] as number) * (w[0] as number),
			];
			// Out along the flow, which runs along +x, or up on the apron.
			expect((n[0] as number) + (n[1] as number)).toBeGreaterThan(0);
			const vertex = indices[k] as number;
			const dot =
				(n[0] as number) * (normals[vertex * 3] as number) +
				(n[1] as number) * (normals[vertex * 3 + 1] as number) +
				(n[2] as number) * (normals[vertex * 3 + 2] as number);
			expect(dot).toBeGreaterThan(0);
		}
		for (let v = 0; v < normals.length / 3; v++)
			expect(
				Math.hypot(
					normals[v * 3] as number,
					normals[v * 3 + 1] as number,
					normals[v * 3 + 2] as number,
				),
			).toBeCloseTo(1, 5);
	});

	it('turns with the lip’s direction', () => {
		const turned = meshOf({ ...SHEET, lip: [0, 0], direction: [0, -3] });
		const straight = meshOf({ ...SHEET, lip: [0, 0], direction: [1, 0] });
		// A quarter turn: +x becomes -z, and the lip's right, +z, becomes +x.
		for (let v = 0; v < straight.positions.length / 3; v++) {
			expect(turned.positions[v * 3] as number).toBeCloseTo(
				straight.positions[v * 3 + 2] as number,
				4,
			);
			expect(turned.positions[v * 3 + 2] as number).toBeCloseTo(
				-(straight.positions[v * 3] as number),
				4,
			);
		}
	});

	it('refuses a fall it cannot draw, and names the setting', () => {
		expect(() => fallSheet({ ...SHEET, drop: 0 })).toThrow(/drop must be above 0/);
		expect(() => fallSheet({ ...SHEET, speed: 0 })).toThrow(/speed must be above 0/);
		expect(() => fallSheet({ ...SHEET, halfWidth: -1 })).toThrow(/half width must be above 0/);
		expect(() => fallSheet({ ...SHEET, direction: [0, 0] })).toThrow(/direction must not be zero/);
		expect(() => fallSheet({ ...SHEET, spread: -0.1 })).toThrow(/spread must be 0 or more/);
		expect(() => fallSheet({ ...SHEET, level: Number.NaN })).toThrow(
			/level must be a finite number/,
		);
		expect(() => fallSheet({ ...SHEET, mesh: { across: 0 } })).toThrow(/sections across/);
	});
});

describe('a waterfall’s spray and mist', () => {
	/** The emitters of the test's fall, by kind. */
	const byKind = (sheet: FallSheet) =>
		Object.fromEntries(fallEmitters(sheet).map((place) => [place.kind, place]));

	it('sprays inside the column that the veils make, over the upper drop', () => {
		const { body } = byKind(SHEET);
		const upper = SHEET.drop * 0.35;
		const at: [number, number] = [0, 0];
		fallPlace(fallTime(upper), SHEET.speed, at);
		const water = SHEET.halfWidth + SHEET.spread * upper;
		// Its box runs from behind the sheet's path to past the front veil's bow.
		const out = (body?.position[0] as number) - 10;
		const depth = body?.box[2] as number;
		expect(out - depth / 2).toBeLessThan(at[0]);
		expect(out + depth / 2).toBeGreaterThan(at[0] + water);
		expect(body?.box[0] as number).toBeGreaterThan(water);
		const top = (body?.position[1] as number) + (body?.box[1] as number) / 2;
		expect(top).toBeLessThanOrEqual(SHEET.level);
	});

	it('froths at the brink, gathers its mist on the fall’s path, and plumes at its foot', () => {
		const { froth, mist, plume } = byKind(SHEET);
		const at: [number, number] = [0, 0];
		// The froth stands just past the lip, a little below the river's surface.
		expect(froth?.position).toEqual([10.25, SHEET.level - 0.1, -4]);
		// The mist stands on the path, two thirds of the way down.
		const middle = SHEET.drop * MIST_DEPTH;
		fallPlace(fallTime(middle), SHEET.speed, at);
		const half = SHEET.halfWidth + SHEET.spread * middle;
		expect(mist?.position[0] as number).toBeCloseTo(10 + at[0] + half * MIST_OUT, 6);
		expect(mist?.position[1] as number).toBeCloseTo(SHEET.level - middle, 6);
		expect(mist?.position[2]).toBe(-4);
		// The plume stands at the foot, past the end of the path.
		fallPlace(fallTime(SHEET.drop), SHEET.speed, at);
		expect(plume?.position[0] as number).toBeGreaterThan(10 + at[0]);
		expect(plume?.position[1] as number).toBeLessThan(SHEET.level - SHEET.drop * 0.9);
	});

	it('spreads its mist over three times the fall’s width, and covers the lower half', () => {
		const { mist } = byKind(SHEET);
		const half = SHEET.halfWidth + SHEET.spread * SHEET.drop * MIST_DEPTH;
		expect(mist?.halfWidth).toBeCloseTo(half, 6);
		expect(mist?.box[0]).toBeCloseTo(2 * half * MIST_WIDTH, 6);
		const top = (mist?.position[1] as number) + (mist?.box[1] as number) / 2;
		expect(top).toBeLessThan(SHEET.level - SHEET.drop * 0.35);
	});

	it('turns every emitter so its box lies across the fall', () => {
		for (const [direction, way] of [
			[
				[2, 0],
				[1, 0],
			],
			[
				[0, -3],
				[0, -1],
			],
			[
				[1, 1],
				[Math.SQRT1_2, Math.SQRT1_2],
			],
		] as const) {
			for (const place of fallEmitters({ ...SHEET, direction })) {
				// The turn takes the emitter's +z, out from the cliff, to the way the water runs.
				expect(Math.sin(place.turn)).toBeCloseTo(way[0], 6);
				expect(Math.cos(place.turn)).toBeCloseTo(way[1], 6);
			}
		}
	});

	it('makes more puffs for a wider fall and a taller one', () => {
		const rate = (sheet: FallSheet) => fallEmitters(sheet).map((place) => place.rate);
		const wide = rate({ ...SHEET, halfWidth: SHEET.halfWidth * 2 });
		const tall = rate({ ...SHEET, drop: SHEET.drop * 2 });
		const own = rate(SHEET);
		for (let k = 0; k < own.length; k++) {
			expect(own[k] as number).toBeGreaterThan(0);
			expect(wide[k] as number).toBeGreaterThan(own[k] as number);
			expect(tall[k] as number).toBeGreaterThanOrEqual(own[k] as number);
		}
	});
});

describe('the sheet’s shader', () => {
	it('reads the veil and the room past the edges as the mesh writes them', () => {
		expect(read('fall.wgsl')).toContain(`const VEIL_ROOM: f32 = ${VEIL_ROOM.toFixed(1)};`);
		expect(read('fall.wgsl')).toContain(`const EDGE_ROOM: f32 = ${EDGE_ROOM.toFixed(1)};`);
	});

	it('measures the gap to a wall as the surface does', () => {
		const body = (source: string) => {
			const start = source.indexOf('fn distance_of(');
			return source.slice(start, source.indexOf('\n}', start));
		};
		expect(body(read('fall.wgsl'))).toBe(body(read('water.wgsl')));
	});
});
