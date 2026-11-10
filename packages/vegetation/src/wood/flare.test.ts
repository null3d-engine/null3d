// The stem's base: its buttress lobes round the section, and its surface roots, which lie half
// buried along the ground or stand from it as ridges, and end below it rather than tapering away in
// the surface. The oak's foot, roots included, is held to its stills' own widths.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { MacroSkeleton } from '../core/graph';
import type { BaseSpec } from '../core/record';
import { loadPlantCode } from '../generate';
import { leadOnThickest } from '../grow/leaders';
import { grower } from '../grow/models';
import { species } from '../species/pedunculate-oak';
import { type StemSection, type SurfaceRoot, stemSection, surfaceRoots } from './flare';

const base: BaseSpec = {
	flare: { amount: 0.6, height: 0.35 },
	buttress: { amount: 0.5, lobes: 5, height: 1.2, sharpness: 2 },
	roots: { count: 5, length: { mean: 1.6, spread: 0.2 }, radius: 0.11, dive: 0.06 },
};

const feet = { x: 0, y: 0, z: 0, radius: 0.32 };

describe('the stem base', () => {
	it('gathers every root into the ground, with no part of its end left in the surface', () => {
		const section = stemSection(base, 11, 7, 0, 0);
		if (!section) throw new Error('no section');
		const roots = surfaceRoots(base, section, feet, [1, 0, 0], [0, 0, 1], 11, 7, 0, 0);
		expect(roots.length).toBeGreaterThan(0);
		for (const root of roots) {
			const n = root.radii.length;
			// The last rings stand wholly under the ground: their centre is deeper than their radius.
			for (const i of [n - 2, n - 1]) {
				const y = root.points[i * 3 + 1] as number;
				expect(y + (root.radii[i] as number)).toBeLessThan(0);
			}
			// And a ring on the way out lies half buried, so the root reads as a cord over the ground.
			let exposed = false;
			for (let i = 0; i < n - 2; i++) {
				const y = root.points[i * 3 + 1] as number;
				const r = root.radii[i] as number;
				if (y + r > 0 && y - r < 0) exposed = true;
			}
			expect(exposed).toBe(true);
		}
	});

	it('buries a root whatever dive the record asks for', () => {
		const spec = base.roots as NonNullable<BaseSpec['roots']>;
		const shallow: BaseSpec = { ...base, roots: { ...spec, dive: 0.001 } };
		const section = stemSection(shallow, 11, 7, 0, 0);
		if (!section) throw new Error('no section');
		const roots = surfaceRoots(shallow, section, feet, [1, 0, 0], [0, 0, 1], 11, 7, 0, 0);
		for (const root of roots) {
			const n = root.radii.length;
			const y = root.points[(n - 1) * 3 + 1] as number;
			expect(y + (root.radii[n - 1] as number)).toBeLessThan(0);
		}
	});

	it('sinks a ridge root into the ground along its length, from its share of its girth', () => {
		const spec = base.roots as NonNullable<BaseSpec['roots']>;
		const ridged: BaseSpec = { ...base, roots: { ...spec, ridge: 0.8 } };
		const section = stemSection(ridged, 11, 7, 0, 0);
		if (!section) throw new Error('no section');
		const roots = surfaceRoots(ridged, section, feet, [1, 0, 0], [0, 0, 1], 11, 7, 0, 0);
		expect(roots.length).toBeGreaterThan(0);
		for (const root of roots) {
			const n = root.radii.length;
			const top = (i: number) => (root.points[i * 3 + 1] as number) + (root.radii[i] as number);
			const out = (i: number) =>
				Math.hypot(root.points[i * 3] as number, root.points[i * 3 + 2] as number);
			// Where it leaves the stem, the root stands its share of its girth out of the ground.
			expect(out(2)).toBeCloseTo(feet.radius, 9);
			expect(top(2)).toBeCloseTo(0.8 * 2 * spec.radius, 9);
			// Its top falls all along the run and meets the ground at the run's end.
			for (let i = 3; i <= n - 3; i++) expect(top(i)).toBeLessThan(top(i - 1));
			expect(top(n - 3)).toBeCloseTo(0, 9);
			// The last rings stand wholly under the ground.
			for (const i of [n - 2, n - 1]) expect(top(i)).toBeLessThan(0);
		}
	});

	it('cuts a fire scar into one side of the first stem alone, deepest at its middle', () => {
		const plain: BaseSpec = { flare: { amount: 0.3, height: 0.5 } };
		const scarred: BaseSpec = {
			...plain,
			scar: {
				from: 0,
				to: 4,
				angle: 90,
				width: 40,
				depth: 0.2,
				colour: [0.012, 0.011, 0.009],
			},
		};
		const a = stemSection(plain, 11, 7, 0, 0);
		const b = stemSection(scarred, 11, 7, 0, 0);
		if (!a || !b) throw new Error('no section');
		const centre = Math.PI / 2;
		// The hollow is the record's depth at its middle, and the healthy bark round it is untouched.
		expect(a.radius(2, centre, 1) - b.radius(2, centre, 1)).toBeCloseTo(0.2, 6);
		expect(b.radius(2, -Math.PI / 2, 1)).toBeCloseTo(a.radius(2, -Math.PI / 2, 1), 6);
		expect(b.radius(5, centre, 1)).toBeCloseTo(a.radius(5, centre, 1), 6);
		// A plant's later stems carry no scar.
		const other = stemSection(scarred, 11, 7, 0, 1);
		if (!other) throw new Error('no second section');
		expect(other.radius(2, centre, 1)).toBeCloseTo(a.radius(2, centre, 1), 6);
	});

	it('widens a tapered bole evenly toward the ground, and leaves it plain above the taper', () => {
		const plain: BaseSpec = { flare: { amount: 0.3, height: 0.5 } };
		const tapered: BaseSpec = { ...plain, taper: { amount: 0.2, height: 4 } };
		const a = stemSection(plain, 11, 7, 0, 0);
		const b = stemSection(tapered, 11, 7, 0, 0);
		if (!a || !b) throw new Error('no section');
		expect(b.reach).toBeGreaterThanOrEqual(4);
		for (const h of [0, 0.5, 1.3, 2, 3, 3.9, 4, 6]) {
			const gain = b.radius(h, 0.3, 1) - a.radius(h, 0.3, 1);
			expect(gain).toBeCloseTo(h < 4 ? 0.2 * (1 - h / 4) : 0, 9);
		}
	});

	it('stands a rounded buttress crest from the ground, and eases it out higher up', () => {
		const spec = base.buttress as NonNullable<BaseSpec['buttress']>;
		const sharp = stemSection({ ...base, flare: { amount: 0, height: 0.35 } }, 11, 7, 0, 0);
		const rounded = stemSection(
			{ ...base, flare: { amount: 0, height: 0.35 }, buttress: { ...spec, round: 1 } },
			11,
			7,
			0,
			0,
		);
		if (!sharp || !rounded) throw new Error('no section');
		const crest = (section: StemSection, h: number) => {
			let most = 0;
			for (const angle of section.lobes) most = Math.max(most, section.radius(h, angle, 1));
			return most;
		};
		// Both crests stand as tall at the ground; a sixth of the fade up, the falling one has lost
		// a tenth of its swell, the rounded one hardly any.
		expect(crest(rounded, 0)).toBeCloseTo(crest(sharp, 0), 6);
		const lost = (section: StemSection) =>
			(crest(section, 0) - crest(section, 0.2)) / (crest(section, 0) - 1);
		expect(lost(sharp)).toBeGreaterThan(0.1);
		expect(lost(rounded)).toBeLessThan(0.03);
		// Past two and a half fades the rounded crest is plain stem.
		// The tallest lobe a draw can give stands 1.55 times the record's height, so past two and a
		// half of that the foot is plain stem again.
		expect(crest(rounded, spec.height * 1.55 * 2.5 + 0.01)).toBeCloseTo(1, 6);
	});

	it(
		'draws the oak bole as stills 01, 02, 17 and 18 show it: an eighth of its height across, on a short concave foot',
		async () => {
			const record = species.record;
			await loadPlantCode(record);
			for (let variant = 0; variant < 6; variant++) {
				const led = leadOnThickest(
					grower('self-organizing').grow({ record, seed: 11, variant, season: 'summer' }),
				);
				const section = stemSection(record.base, 11, record.seedSalt, variant, 0);
				const foot = {
					x: 0,
					y: 0,
					z: 0,
					radius: led.radius[led.axes.first[0] as number] as number,
				};
				const roots = surfaceRoots(
					record.base,
					section,
					foot,
					[1, 0, 0],
					[0, 0, 1],
					11,
					record.seedSalt,
					variant,
					0,
				);
				const width = (y: number) => drawnWidth(section, roots, y, stemPipeAt(led, y));
				// The whole-tree stills: 0.115 (02), 0.126 (18) and 0.168 (01) of the height at breast
				// height, and the photographs of the species span 0.116 to 0.178. The pictures set the band,
				// not a narrower figure from one still.
				const breast = width(1.3) / led.height;
				expect(breast).toBeGreaterThan(0.116);
				expect(breast).toBeLessThan(0.178);
				// Their foot, as a multiple of the narrowest bole above it: about 1.8 a quarter metre up,
				// 1.2 at 0.85 m, and nearly plain by 1.25 m.
				let waist = Number.POSITIVE_INFINITY;
				for (let y = 1.2; y <= 2.5; y += 0.1) waist = Math.min(waist, width(y));
				expect(width(0.25) / waist).toBeGreaterThan(1.5);
				expect(width(0.25) / waist).toBeLessThan(2.1);
				expect(width(0.85) / waist).toBeGreaterThan(1.05);
				expect(width(0.85) / waist).toBeLessThan(1.35);
				expect(width(1.25) / waist).toBeLessThan(1.2);
			}
		},
		scaledBudget(60_000),
	);
});

/** The main stem's pipe radius at a height, from its nodes. */
function stemPipeAt(skeleton: MacroSkeleton, y: number): number {
	const { axes, position: p, radius } = skeleton;
	const first = axes.first[0] as number;
	for (let n = first; n < (axes.last[0] as number); n++) {
		const y0 = p[n * 3 + 1] as number;
		const y1 = p[(n + 1) * 3 + 1] as number;
		if (y < y0 || y > y1 || y1 <= y0) continue;
		const t = (y - y0) / (y1 - y0);
		return (radius[n] as number) * (1 - t) + (radius[n + 1] as number) * t;
	}
	return radius[first] as number;
}

/**
 * The foot's silhouette width at a height, the mean over the directions it is seen from: the
 * section's outline, and each root's girth where its tube reaches that height, read along its run.
 */
function drawnWidth(
	section: StemSection | undefined,
	roots: readonly SurfaceRoot[],
	y: number,
	pipe: number,
): number {
	const angles = 36;
	const points: number[] = [];
	const halves: number[] = [];
	for (let k = 0; k < angles; k++) {
		const theta = (k / angles) * 2 * Math.PI;
		const rho = section ? section.radius(y, theta, pipe) : pipe;
		points.push(rho * Math.cos(theta), rho * Math.sin(theta));
		halves.push(0);
	}
	const steps = 8;
	for (const root of roots)
		for (let i = 0; i + 1 < root.radii.length; i++)
			for (let s = 0; s <= steps; s++) {
				const k = s / steps;
				const at = (c: number) =>
					(root.points[i * 3 + c] as number) * (1 - k) +
					(root.points[(i + 1) * 3 + c] as number) * k;
				const r = (root.radii[i] as number) * (1 - k) + (root.radii[i + 1] as number) * k;
				const dy = y - at(1);
				if (Math.abs(dy) >= r) continue;
				points.push(at(0), at(2));
				halves.push(Math.sqrt(r * r - dy * dy));
			}
	let sum = 0;
	for (let v = 0; v < angles / 2; v++) {
		const phi = (v / angles) * 2 * Math.PI;
		const cx = Math.cos(phi);
		const cz = Math.sin(phi);
		let near = 0;
		let far = 0;
		for (let j = 0; j < halves.length; j++) {
			const along = (points[j * 2] as number) * cx + (points[j * 2 + 1] as number) * cz;
			near = Math.max(near, along + (halves[j] as number));
			far = Math.max(far, -along + (halves[j] as number));
		}
		sum += near + far;
	}
	return sum / (angles / 2);
}
