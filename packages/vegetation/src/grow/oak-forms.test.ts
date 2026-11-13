// The pedunculate oak's other forms, grown on the self-organizing grower: the woodland oak of stills
// 30 and 31, a long clean bole under a small high crown, and the young oak of still 32, one slim
// stem with thin limbs. Each figure is read from the grown skeleton, as the reference shows it.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { formRecord } from '../core/forms';
import type { MacroSkeleton } from '../core/graph';
import { loadPlantCode } from '../generate';
import { leadOnThickest } from './leaders';
import { grower } from './models';
import { species } from './oak-self-organizing.fixture';

/** The figures of one grown form, each a share of the plant's height unless it says otherwise. */
interface FormFigures {
	/** Where the lowest live limb leaves the stem. */
	readonly firstLimb: number;
	/** How high the stem's own line runs. */
	readonly stemTop: number;
	/** The lowest bud site, where the foliage starts. */
	readonly crownBase: number;
	/** The wood's widest run across, in either level direction. */
	readonly width: number;
	/** The stem's diameter at 1.3 m, in metres. */
	readonly dbh: number;
	/** The plant's height, in metres. */
	readonly height: number;
	/** The node and bud-site coordinates that are not finite numbers. */
	readonly nonFinite: number;
	/** The limbs that leave the stem, and the side axes that leave any other axis. */
	readonly limbs: number;
	readonly twigs: number;
}

/** The figures of a grown skeleton. */
function figuresOf(skeleton: MacroSkeleton): FormFigures {
	const { axes, position: p, radius } = skeleton;
	const height = skeleton.height;
	let firstLimb = Number.POSITIVE_INFINITY;
	let stemTop = 0;
	let dbh = 0;
	let limbs = 0;
	let twigs = 0;
	for (let a = 0; a < axes.count; a++) {
		if ((axes.order[a] as number) === 0) {
			for (let n = axes.first[a] as number; n <= (axes.last[a] as number); n++) {
				const y = p[n * 3 + 1] as number;
				stemTop = Math.max(stemTop, y);
				const next = p[(n + 1) * 3 + 1] as number;
				if (n < (axes.last[a] as number) && y <= 1.3 && next >= 1.3) {
					const w = (1.3 - y) / Math.max(1e-6, next - y);
					dbh = 2 * ((radius[n] as number) * (1 - w) + (radius[n + 1] as number) * w);
				}
			}
			continue;
		}
		const parent = axes.parent[a] as number;
		const node = axes.parentNode[a] as number;
		if (parent < 0 || node < 0) continue;
		if ((axes.order[parent] as number) !== 0) {
			twigs++;
			continue;
		}
		limbs++;
		firstLimb = Math.min(firstLimb, p[node * 3 + 1] as number);
	}
	let nonFinite = 0;
	for (const value of p) if (!Number.isFinite(value)) nonFinite++;
	for (const value of skeleton.buds.position) if (!Number.isFinite(value)) nonFinite++;
	const { min, max } = skeleton.bounds;
	return {
		firstLimb: firstLimb / height,
		stemTop: stemTop / height,
		crownBase: skeleton.crownBase / height,
		width: Math.max(max[0] - min[0], max[2] - min[2]) / height,
		dbh,
		height,
		nonFinite,
		limbs,
		twigs,
	};
}

/** Grows one variant of a form, with the stem led on as the generator leads it. */
async function grownForm(form: string, variant: number): Promise<FormFigures> {
	const record = formRecord(species.record, form);
	await loadPlantCode(record);
	return figuresOf(
		leadOnThickest(grower('self-organizing').grow({ record, seed: 11, variant, season: 'summer' })),
	);
}

describe("the pedunculate oak's other forms", () => {
	it(
		'grows a woodland oak with a long clean bole under a small high crown, as stills 30 and 31 show',
		async () => {
			for (let variant = 0; variant < species.record.variants; variant++) {
				const figures = await grownForm('woodland', variant);
				expect(figures.nonFinite).toBe(0);
				// Stills 30 and 31: no limb leaves the bole below about half the height, and the foliage
				// starts no lower.
				expect(figures.firstLimb).toBeGreaterThanOrEqual(0.4);
				expect(figures.crownBase).toBeGreaterThanOrEqual(0.4);
				// Still 30: one leader runs up through the crown, near to the top.
				expect(figures.stemTop).toBeGreaterThanOrEqual(0.85);
				// Still 30: a narrow crown, well under the open oak's one and a half times its height.
				expect(figures.width).toBeLessThanOrEqual(0.8);
				// Still 30: the bole is about a twentieth of the height across at breast height.
				expect(figures.dbh / figures.height).toBeGreaterThan(0.03);
				expect(figures.dbh / figures.height).toBeLessThan(0.07);
			}
		},
		scaledBudget(60_000),
	);

	it('grows a young oak as one slim stem with thin limbs, as still 32 shows', async () => {
		const record = formRecord(species.record, 'young');
		// A young oak bears no acorns and stands on a plain foot.
		expect(record.extras).toBeUndefined();
		expect(record.base?.buttress).toBeUndefined();
		for (let variant = 0; variant < species.record.variants; variant++) {
			const figures = await grownForm('young', variant);
			expect(figures.nonFinite).toBe(0);
			// Still 32: about four metres tall.
			expect(figures.height).toBeGreaterThan(2.5);
			expect(figures.height).toBeLessThan(5);
			// Still 32: one stem runs to the top; no limb takes over from it.
			expect(figures.stemTop).toBeGreaterThanOrEqual(0.9);
			// Still 32: the stem is bare for the first third or so of the height.
			expect(figures.firstLimb).toBeGreaterThanOrEqual(0.25);
			// Still 32: about ten limbs leave the stem, each running out unbranched to its rosette.
			expect(figures.limbs).toBeGreaterThanOrEqual(7);
			expect(figures.limbs).toBeLessThanOrEqual(14);
			expect(figures.twigs).toBe(0);
			// Still 32: a stem a few centimetres across.
			expect(figures.dbh).toBeGreaterThan(0.03);
			expect(figures.dbh).toBeLessThan(0.09);
		}
	});
});
