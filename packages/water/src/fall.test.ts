// The waterfall's column: it starts at the lip's height and width, follows the path of falling
// water, never rises, widens as it falls, hangs thin under the brink and deepens as it falls, and
// looks out from its middle. The spray's emitters stand at the brink, in the column, about
// it lower down and at the foot, turned across the fall.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	APRON,
	APRON_LIFT,
	BRINK,
	brinkAt,
	COLUMN_DEPTH,
	columnDepth,
	drawnHalf,
	FALL_SPEED,
	type FallSheet,
	fallEmitters,
	fallPlace,
	fallSheet,
	fallTime,
	GRAVITY,
	MIST_DENSITY,
	MIST_DEPTH,
	MIST_WIDTH,
	mistBillow,
	sideAt,
	TONGUE,
	WOBBLE,
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

/** How far the brink shifts a vertex out past the path, from its place across in the first coordinate. */
function shiftOf(sheet: FallSheet, uvs: Float32Array, vertex: number): number {
	const out: [number, number] = [0, 0];
	brinkAt((uvs[vertex * 2] as number) / sheet.halfWidth, out);
	return out[0];
}

/** The column's vertices, as rows from the apron's top to the foot, each row round the section. */
function rowsOf(sheet: FallSheet): number[][] {
	const columns = (sheet.mesh?.across as number) + 1;
	const { positions } = meshOf(sheet);
	const rows: number[][] = [];
	for (let v = 0; v < positions.length / 3; v++) {
		if (v % columns === 0) rows.push([]);
		(rows[rows.length - 1] as number[]).push(v);
	}
	return rows;
}

/** How far out from the lip, along the flow, a row reaches at its back and its front, in meters. */
function outOf(positions: Float32Array, row: number[]): [back: number, front: number] {
	const xs = row.map((v) => (positions[v * 3] as number) - 10);
	return [Math.min(...xs), Math.max(...xs)];
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

describe('a waterfall’s column', () => {
	/** The row where the water crosses the lip: the first whose time is not negative. */
	const lipRow = () => {
		const { uvs } = meshOf(SHEET);
		return rowsOf(SHEET).find(
			(row) => (uvs[(row[0] as number) * 2 + 1] as number) >= 0,
		) as number[];
	};

	it('starts at the lip’s height, across the lip’s width, as thin as the tongue', () => {
		const { positions, uvs } = meshOf(SHEET);
		const row = lipRow();
		expect(uvs[(row[0] as number) * 2 + 1]).toBe(0);
		for (const v of row) {
			expect(positions[v * 3] as number).toBeCloseTo(10 + shiftOf(SHEET, uvs, v), 5);
			expect(positions[v * 3 + 1] as number).toBeCloseTo(SHEET.level + APRON_LIFT, 5);
		}
		const zs = row.map((v) => positions[v * 3 + 2] as number);
		expect(Math.min(...zs)).toBeCloseTo(-4 - SHEET.halfWidth, 3);
		expect(Math.max(...zs)).toBeCloseTo(-4 + SHEET.halfWidth, 3);
		expect(columnDepth(SHEET.halfWidth, 1e-6)).toBeCloseTo(TONGUE, 4);
	});

	it('lies on the river’s surface upstream of the lip, over the apron', () => {
		const { positions, uvs, normals } = meshOf(SHEET);
		const top = rowsOf(SHEET)[0] as number[];
		expect(uvs[(top[0] as number) * 2 + 1] as number).toBeCloseTo(-APRON / SHEET.speed, 5);
		for (const v of top) {
			expect(positions[v * 3] as number).toBeCloseTo(10 - APRON + shiftOf(SHEET, uvs, v), 4);
			expect(positions[v * 3 + 1] as number).toBeCloseTo(SHEET.level + APRON_LIFT, 5);
			expect(normals[v * 3 + 1]).toBe(1);
		}
	});

	it('reaches as far up the river as the apron it is given, on the river’s surface', () => {
		const long = { ...SHEET, apron: 2.5 };
		const { positions, uvs } = meshOf(long);
		const top = rowsOf(long)[0] as number[];
		expect(uvs[(top[0] as number) * 2 + 1] as number).toBeCloseTo(-2.5 / SHEET.speed, 5);
		for (const v of top) {
			expect(positions[v * 3] as number).toBeCloseTo(10 - 2.5 + shiftOf(long, uvs, v), 4);
			expect(positions[v * 3 + 1] as number).toBeCloseTo(SHEET.level + APRON_LIFT, 5);
		}
		// Every row before the brink lies flat on the river, between the apron's end and the brink.
		for (const row of rowsOf(long)) {
			const t = uvs[(row[0] as number) * 2 + 1] as number;
			if (t >= 0) break;
			for (const v of row) {
				expect(positions[v * 3] as number).toBeGreaterThanOrEqual(10 - 2.5 - 1e-4);
				expect(positions[v * 3] as number).toBeLessThanOrEqual(10 + BRINK + 1e-4);
				expect(positions[v * 3 + 1] as number).toBeCloseTo(SHEET.level + APRON_LIFT, 5);
			}
		}
	});

	it('turns down at an uneven brink, never behind the lip’s line and never far past it', () => {
		const { positions, uvs } = meshOf(SHEET);
		const xs = lipRow().map((v) => positions[v * 3] as number);
		for (const x of xs) {
			expect(x).toBeGreaterThanOrEqual(10 - 1e-6);
			expect(x).toBeLessThanOrEqual(10 + BRINK + 1e-6);
		}
		// The brink is not a ruler line: across the lip it moves out by more than a third of its most.
		expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(BRINK / 3);
		// Front and back at one place across shift alike, so the column keeps its depth: with the
		// section's own depth taken away, a front point and the back point across from it stand
		// equally far out.
		const { uvs1 } = meshOf(SHEET);
		const around = SHEET.mesh?.across as number;
		const at: [number, number] = [0, 0];
		const row = rowsOf(SHEET)[20] as number[];
		fallPlace(uvs[(row[0] as number) * 2 + 1] as number, SHEET.speed, at);
		const depth = columnDepth(SHEET.halfWidth, at[1]);
		const bare = (v: number) =>
			(positions[v * 3] as number) - depth * (1 + Math.cos((uvs1[v * 2] as number) * Math.PI * 2));
		for (let k = 1; k < around / 2; k++)
			expect(bare(row[k] as number)).toBeCloseTo(bare(row[around / 2 - k] as number), 4);
	});

	it('follows the path of falling water: its back on the path, its front a full depth out', () => {
		const { positions, uvs, uvs1 } = meshOf(SHEET);
		const at: [number, number] = [0, 0];
		for (let v = 0; v < positions.length / 3; v++) {
			const t = uvs[v * 2 + 1] as number;
			const angle = (uvs1[v * 2] as number) * Math.PI * 2;
			fallPlace(t, SHEET.speed, at);
			const depth = columnDepth(SHEET.halfWidth, at[1]);
			const side: [number, number] = [0, 0];
			sideAt(SHEET.halfWidth, SHEET.spread, at[1], Math.sin(angle) >= 0 ? 1 : -1, side);
			const half = side[0];
			expect(positions[v * 3] as number).toBeCloseTo(
				10 + at[0] + depth * (1 + Math.cos(angle)) + shiftOf(SHEET, uvs, v),
				3,
			);
			expect(positions[v * 3 + 1] as number).toBeCloseTo(SHEET.level + APRON_LIFT - at[1], 3);
			expect(positions[v * 3 + 2] as number).toBeCloseTo(-4 + half * Math.sin(angle), 3);
			expect(uvs1[v * 2 + 1] as number).toBeCloseTo(at[1], 3);
		}
	});

	it('never rises, stays clear of the lip’s line, and reaches the drop at its foot', () => {
		const { positions } = meshOf(SHEET);
		const rows = rowsOf(SHEET);
		for (let column = 0; column < (rows[0] as number[]).length; column++) {
			let last = Number.POSITIVE_INFINITY;
			for (const row of rows) {
				const y = positions[(row[column] as number) * 3 + 1] as number;
				expect(y).toBeLessThanOrEqual(last);
				last = y;
				// No part of the falling water lies behind the lip's line, toward the wall.
				if (y < SHEET.level)
					expect(positions[(row[column] as number) * 3] as number).toBeGreaterThan(10);
			}
			expect(last).toBeCloseTo(SHEET.level + APRON_LIFT - SHEET.drop, 3);
		}
	});

	it('draws in over its first meters, its two sides uneven, then widens by its spread', () => {
		const { positions, uvs1 } = meshOf(SHEET);
		const rows = rowsOf(SHEET);
		const at = (fallen: number) =>
			rows.find((row) => (uvs1[(row[0] as number) * 2 + 1] as number) >= fallen) as number[];
		/** How far each side of a row reaches from the middle of the lip, in meters. */
		const reach = (row: number[]) => {
			const zs = row.map((v) => (positions[v * 3 + 2] as number) + 4);
			return { right: Math.max(...zs), left: -Math.min(...zs) };
		};
		const lip = reach(at(0));
		expect(lip.right).toBeCloseTo(SHEET.halfWidth, 3);
		expect(lip.left).toBeCloseTo(SHEET.halfWidth, 3);
		// A few meters down the water has drawn in, so rock shows beside it in a notch as wide as the
		// lip, and the two sides stand at different widths.
		const drawn = reach(at(4));
		expect(drawn.right + drawn.left).toBeLessThan(2 * SHEET.halfWidth);
		let uneven = 0;
		for (const fallen of [2, 4, 6, 8, 10]) {
			const r = reach(at(fallen));
			uneven = Math.max(uneven, Math.abs(r.right - r.left));
		}
		expect(uneven).toBeGreaterThan(SHEET.halfWidth * WOBBLE);
		// At the foot the spread has widened it again.
		const foot = reach(rows[rows.length - 1] as number[]);
		const side: [number, number] = [0, 0];
		sideAt(SHEET.halfWidth, SHEET.spread, SHEET.drop, 1, side);
		expect(foot.right).toBeCloseTo(side[0], 2);
		expect(foot.right + foot.left).toBeGreaterThan(2 * SHEET.halfWidth);
	});

	it('gives each side’s width a rate that matches its change', () => {
		const out: [number, number] = [0, 0];
		const ahead: [number, number] = [0, 0];
		for (const side of [1, -1])
			for (const fallen of [0.5, 3, 9]) {
				sideAt(2.5, 0.1, fallen, side, out);
				sideAt(2.5, 0.1, fallen + 1e-4, side, ahead);
				expect(out[1]).toBeCloseTo((ahead[0] - out[0]) / 1e-4, 3);
			}
	});

	it('hangs thin below the brink and deepens slowly as it falls, a solid column', () => {
		const { positions, uvs1 } = meshOf(SHEET);
		const rows = rowsOf(SHEET);
		const at = (fallen: number) =>
			rows.find((row) => (uvs1[(row[0] as number) * 2 + 1] as number) >= fallen) as number[];
		// Thin under the brink, so its water hangs close to the rock, and deeper with each meter it
		// falls, toward the creek's width times the column's share.
		const full = 2 * COLUMN_DEPTH * SHEET.halfWidth;
		const depths = [2, 6, 10, 14, 19].map((fallen) => {
			const [back, front] = outOf(positions, at(fallen));
			return front - back;
		});
		expect(depths[0] as number).toBeLessThan(full * 0.6);
		for (let k = 1; k < depths.length; k++)
			expect(depths[k] as number).toBeGreaterThan(depths[k - 1] as number);
		expect(depths[4] as number).toBeGreaterThan(full * 0.95);
		expect(depths[4] as number).toBeLessThan(full * 1.01);
		// The front arcs out over the first meters and then falls nearly straight: below 6 m it moves
		// out by less than a tenth of the drop.
		const [, front6] = outOf(positions, at(6));
		const [, front19] = outOf(positions, at(19));
		expect(front19 - front6).toBeLessThan(SHEET.drop * 0.1);
	});

	it('looks out from its middle, on every triangle and every vertex', () => {
		const { positions, normals, indices, uvs } = meshOf(SHEET);
		const corner = (index: number) =>
			[0, 1, 2].map((axis) => positions[(indices[index] as number) * 3 + axis] as number);
		const at: [number, number] = [0, 0];
		for (let k = 0; k < indices.length; k += 3) {
			const vertex = indices[k] as number;
			const t = uvs[vertex * 2 + 1] as number;
			// The rows at the lip itself are a thin tongue that folds over the brink, where out from
			// the middle is no direction; the column's checks start half a meter down.
			fallPlace(t, SHEET.speed, at);
			if (at[1] < 0.5) continue;
			const [a, b, c] = [corner(k), corner(k + 1), corner(k + 2)] as number[][];
			const u = (a as number[]).map((value, axis) => ((b as number[])[axis] as number) - value);
			const w = (a as number[]).map((value, axis) => ((c as number[])[axis] as number) - value);
			const n = [
				(u[1] as number) * (w[2] as number) - (u[2] as number) * (w[1] as number),
				(u[2] as number) * (w[0] as number) - (u[0] as number) * (w[2] as number),
				(u[0] as number) * (w[1] as number) - (u[1] as number) * (w[0] as number),
			];
			// Out from the column's middle at this height.
			const middle = [
				10 + at[0] + columnDepth(SHEET.halfWidth, at[1]) + shiftOf(SHEET, uvs, vertex),
				-4,
			];
			const outward = [
				((a as number[])[0] as number) - (middle[0] as number),
				((a as number[])[2] as number) - (middle[1] as number),
			];
			const dot =
				(n[0] as number) * (outward[0] as number) + (n[2] as number) * (outward[1] as number);
			expect(dot).toBeGreaterThan(0);
			const own =
				(n[0] as number) * (normals[vertex * 3] as number) +
				(n[1] as number) * (normals[vertex * 3 + 1] as number) +
				(n[2] as number) * (normals[vertex * 3 + 2] as number);
			expect(own).toBeGreaterThan(0);
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
		expect(() => fallSheet({ ...SHEET, apron: 0 })).toThrow(/apron must be above 0/);
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

	it('throws drops off the column, over the upper two thirds of the drop', () => {
		const { drops } = byKind(SHEET);
		const upper = SHEET.drop * 0.35;
		const at: [number, number] = [0, 0];
		fallPlace(fallTime(upper), SHEET.speed, at);
		const depth = columnDepth(SHEET.halfWidth, upper);
		// Its box runs from behind the column's back to past its front, across the water's width.
		const out = (drops?.position[0] as number) - 10;
		const thick = drops?.box[2] as number;
		expect(out - thick / 2).toBeLessThan(at[0]);
		expect(out + thick / 2).toBeGreaterThan(at[0] + 2 * depth);
		expect(drops?.box[0] as number).toBeGreaterThan(
			2 * drawnHalf(SHEET.halfWidth, SHEET.spread, upper),
		);
		// It stays in the upper drop: its top below the lip, its foot above the fall's lower quarter.
		const top = (drops?.position[1] as number) + (drops?.box[1] as number) / 2;
		const foot = (drops?.position[1] as number) - (drops?.box[1] as number) / 2;
		expect(top).toBeLessThanOrEqual(SHEET.level);
		expect(foot).toBeGreaterThan(SHEET.level - SHEET.drop * 0.75);
	});

	it('froths at the brink, gathers its mist about the column, and plumes at its foot', () => {
		const { froth, mist, plume } = byKind(SHEET);
		const at: [number, number] = [0, 0];
		// The froth stands just past the lip, a little below the river's surface.
		expect(froth?.position).toEqual([10.25, SHEET.level - 0.1, -4]);
		// The mist stands about the column's middle, most of the way down.
		const middle = SHEET.drop * MIST_DEPTH;
		fallPlace(fallTime(middle), SHEET.speed, at);
		const depth = columnDepth(SHEET.halfWidth, middle);
		expect(mist?.position[0] as number).toBeCloseTo(10 + at[0] + depth, 6);
		expect(mist?.position[1] as number).toBeCloseTo(SHEET.level - middle, 6);
		expect(mist?.position[2]).toBe(-4);
		// The plume stands at the foot, past the end of the path.
		fallPlace(fallTime(SHEET.drop), SHEET.speed, at);
		expect(plume?.position[0] as number).toBeGreaterThan(10 + at[0]);
		expect(plume?.position[1] as number).toBeLessThan(SHEET.level - SHEET.drop * 0.9);
	});

	it('gathers its mist round the fall’s foot, several times as wide as the water there', () => {
		const { mist } = byKind(SHEET);
		const half = drawnHalf(SHEET.halfWidth, SHEET.spread, SHEET.drop * MIST_DEPTH);
		expect(mist?.halfWidth).toBeCloseTo(half, 6);
		expect(mist?.box[0]).toBeCloseTo(2 * half * MIST_WIDTH, 6);
		// The water draws in below the lip, so the mist is sized by the water, not by the lip.
		expect(half).toBeLessThan(SHEET.halfWidth + SHEET.spread * SHEET.drop * MIST_DEPTH);
		const top = (mist?.position[1] as number) + (mist?.box[1] as number) / 2;
		expect(top).toBeLessThan(SHEET.level - SHEET.drop * 0.6);
	});

	it('sizes the mist’s billows by the lip and keeps a short fall’s below its lip', () => {
		// A tall fall’s billows are twice the lip’s width.
		expect(mistBillow({ ...SHEET, drop: 60 })).toBeCloseTo(4 * SHEET.halfWidth, 9);
		// A short fall’s are smaller than its drop, so none reaches up to the lip.
		for (const drop of [2, 6, 20]) {
			const sheet = { ...SHEET, drop };
			const { mist } = byKind(sheet);
			const top = (mist?.position[1] as number) + (mist?.box[1] as number) / 2;
			expect(top + mistBillow(sheet) / 2).toBeLessThan(sheet.level);
		}
	});

	it('keeps its mist as dense for any fall, so it reads as one cloud', () => {
		// The billows born each second over the box's face, in squares of a billow's width.
		const density = (sheet: FallSheet) => {
			const { mist } = byKind(sheet);
			const box = mist?.box as readonly number[];
			return (
				((mist?.rate as number) * mistBillow(sheet) ** 2) /
				((box[0] as number) * (box[1] as number))
			);
		};
		for (const sheet of [
			SHEET,
			{ ...SHEET, halfWidth: 6 },
			{ ...SHEET, drop: 4 },
			{ ...SHEET, drop: 80 },
		])
			expect(density(sheet)).toBeCloseTo(MIST_DENSITY, 9);
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

	it('makes more spray for a wider fall and a taller one', () => {
		// The mist keeps its density instead, above.
		const rate = (sheet: FallSheet) =>
			fallEmitters(sheet)
				.filter((place) => place.kind !== 'mist')
				.map((place) => place.rate);
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

describe('the column’s shader', () => {
	it('measures the gap to a wall as the surface does', () => {
		const body = (source: string) => {
			const start = source.indexOf('fn distance_of(');
			return source.slice(start, source.indexOf('\n}', start));
		};
		expect(body(read('fall.wgsl'))).toBe(body(read('water.wgsl')));
	});

	it('vanishes below a cloud’s top, each clump at its own depth, as the last word on its cover', () => {
		const shader = read('fall.wgsl');
		// Nothing after the fade changes the water's cover again.
		expect(shader).toMatch(
			/alpha \*= smoothstep\(material\.fadeBelow - material\.sinkDepth, material\.fadeBelow \+ SINK_LEAD, sink\);\s*s\.alpha = clamp\(alpha, 0\.0, 1\.0\);/,
		);
		expect(shader).toContain('let sink = input.worldPosition.y + (froth - 0.5) * 0.8;');
		expect(shader).toContain(
			'alpha *= smoothstep(material.fadeBelow - material.sinkDepth, material.fadeBelow + SINK_LEAD, sink);',
		);
	});

	it('keeps the apron and the brink whole near a wall, so the lip draws no line', () => {
		const shader = read('fall.wgsl');
		expect(shader).toContain('let on_brink = 1.0 - smoothstep(0.4, 1.5, fallen);');
		expect(shader).toContain(
			'alpha *= mix(smoothstep(0.0, material.softness, gap), 1.0, on_brink);',
		);
	});

	it('sizes the froth’s clumps by the speed of the path’s water', () => {
		const constant = (name: string) =>
			Number(new RegExp(`const ${name}: f32 = ([0-9.]+);`).exec(read('fall.wgsl'))?.[1]);
		expect(constant('FALL_SPEED')).toBe(FALL_SPEED);
		expect(constant('DRAG_TIME')).toBeCloseTo(FALL_SPEED / GRAVITY, 6);
	});
});
