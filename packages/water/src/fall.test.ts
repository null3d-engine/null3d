// The waterfall's sheet: it starts at the lip's height and width, follows the path of falling
// water, never rises, widens as it falls and looks out from the cliff. The shader reads the veil
// from the mesh's second texture coordinate, so the two keep one layout.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	APRON,
	APRON_LIFT,
	FALL_SPEED,
	type FallSheet,
	fallPlace,
	fallSheet,
	fallTime,
	GRAVITY,
	SHEET_VEIL,
	SIDE_SLOWING,
	VEIL_ROOM,
	VEILS,
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
		const zs = lipRow.map((v) => positions[v * 3 + 2] as number);
		expect(Math.min(...zs)).toBeCloseTo(-4 - SHEET.halfWidth, 5);
		expect(Math.max(...zs)).toBeCloseTo(-4 + SHEET.halfWidth, 5);
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
			const half = (SHEET.halfWidth + SHEET.spread * at[1]) * (VEILS[veil]?.width as number);
			expect(positions[v * 3] as number).toBeCloseTo(10 + at[0], 3);
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
		expect(last).toBeCloseTo(2 * (SHEET.halfWidth + SHEET.spread * SHEET.drop), 3);
	});

	it('hangs its back veil behind the sheet, toward the cliff, and its spray in front', () => {
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
		// A quarter turn: +x becomes -z, and the lip's left, +z, becomes +x.
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

describe('the sheet’s shader', () => {
	it('reads the veil with the mesh’s own room for each veil', () => {
		expect(read('fall.wgsl')).toContain(`const VEIL_ROOM: f32 = ${VEIL_ROOM.toFixed(1)};`);
	});

	it('measures the gap to a wall as the surface does', () => {
		const body = (source: string) => {
			const start = source.indexOf('fn distance_of(');
			return source.slice(start, source.indexOf('\n}', start));
		};
		expect(body(read('fall.wgsl'))).toBe(body(read('water.wgsl')));
	});
});
