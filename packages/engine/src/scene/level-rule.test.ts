import { describe, expect, test } from 'bun:test';
import {
	LEAST_LEVEL_DISTANCE,
	type LevelSwitch,
	type LevelView,
	levelAt,
	levelDistances,
	levelSwitchDistance,
} from './level-rule';

/**
 * A view whose projection's `P[1][1]` is `p11`, for a render `height` pixels high. The rule's
 * figures in the core's own tests name `P[1][1]`, so the tests here turn it back into a field of
 * view.
 */
function viewOf(p11: number, height = 1000): LevelView {
	return { height, fov: (2 * Math.atan(1 / p11) * 180) / Math.PI, threshold: 1 };
}

const ERRORS: readonly LevelSwitch[] = [{ error: 0.01 }, { error: 0.04 }, { error: 0.2 }];

describe("the figures of the core's own rule", () => {
	test('a view 1,000 pixels high and 90 degrees high has a factor of 500', () => {
		// The core: `LevelRule::new(1000.0, 1.0, false, 1.0, 0.0)` gives a factor of 500, so errors
		// of 1 cm, 4 cm and 20 cm switch at 5 m, 20 m and 100 m.
		const view = viewOf(1);
		expect(levelSwitchDistance(view, { error: 0.01 }, 1)).toBeCloseTo(5, 6);
		expect(levelSwitchDistance(view, { error: 0.04 }, 1)).toBeCloseTo(20, 6);
		expect(levelSwitchDistance(view, { error: 0.2 }, 1)).toBeCloseTo(100, 6);
	});

	test('the coarsest level whose switch lies under the distance draws', () => {
		const view = viewOf(1);
		const cases: readonly (readonly [number, number])[] = [
			[1, 0],
			[4.99, 0],
			[5.01, 1],
			[19.9, 1],
			[20.1, 2],
			[99, 2],
			[101, 3],
		];
		for (const [distance, level] of cases)
			expect(levelAt(view, ERRORS, 1, 0, distance), `${distance} m`).toBe(level);
		// A copy of twice the scale switches at twice the distance.
		expect(levelAt(view, ERRORS, 2, 0, 9.9)).toBe(0);
		expect(levelAt(view, ERRORS, 2, 0, 10.1)).toBe(1);
	});

	test('a level given by a distance switches there whatever the screen', () => {
		const levels: readonly LevelSwitch[] = [{ distance: 20 }, { distance: 40 }, { distance: 80 }];
		for (const height of [1080, 2160]) {
			const view = viewOf(1, height);
			expect(levelAt(view, levels, 1, 0, 19)).toBe(0);
			expect(levelAt(view, levels, 1, 0, 21)).toBe(1);
			expect(levelAt(view, levels, 1, 0, 45)).toBe(2);
			expect(levelAt(view, levels, 1, 0, 90)).toBe(3);
		}
		// The scale multiplies a hand-set distance, and a bias above 1 switches nearer.
		expect(levelAt(viewOf(1), levels, 2, 0, 45)).toBe(1);
		expect(levelAt({ ...viewOf(1), bias: 2 }, levels, 1, 0, 45)).toBe(3);
	});

	test('a level given by coverage switches where the bounds cover that share', () => {
		const levels: readonly LevelSwitch[] = [
			{ coverage: 0.25 },
			{ coverage: 0.1 },
			{ coverage: 0.04 },
		];
		const view = viewOf(1);
		// A radius of 2 m covers a quarter of the height at 8 m, a tenth at 20 m and a twenty-fifth
		// at 50 m.
		expect(levelAt(view, levels, 1, 2, 7)).toBe(0);
		expect(levelAt(view, levels, 1, 2, 9)).toBe(1);
		expect(levelAt(view, levels, 1, 2, 25)).toBe(2);
		expect(levelAt(view, levels, 1, 2, 60)).toBe(3);
		expect(levelSwitchDistance(view, { coverage: 0.25 }, 1, 2)).toBeCloseTo(8, 6);
		// A taller render does not move a switch that is measured by coverage.
		expect(levelAt(viewOf(1, 2160), levels, 1, 2, 9)).toBe(1);
	});

	test('an orthographic view picks by scale alone', () => {
		// The core's view is 1,000 pixels high with P[1][1] of 0.2, so its factor is 100, and its
		// error distance stays 1: 1 cm covers exactly a pixel at scale 1.
		const view = { ...viewOf(0.2), orthographic: true };
		const at = levelDistances(view, { centre: [1e5, 0, 0], radius: 1 });
		expect(at).toEqual({ camera: 1e5 - 1, error: 1 });
		const cases: readonly (readonly [number, number])[] = [
			// A hair past scale 1, since at exactly 1 the switch and the distance are equal and
			// floating point puts the comparison on either side.
			[1.01, 0],
			[0.5, 1],
			[0.2, 2],
			[0.04, 3],
		];
		for (const [scale, level] of cases)
			expect(levelAt(view, ERRORS, scale, 1, at), `scale ${scale}`).toBe(level);
	});

	test('an error measures halfway into the bounds, capped near a large mesh', () => {
		const view = viewOf(1);
		// A sphere of radius 2 m centered 5 m away: its nearest point is 3 m away, and its error
		// distance, to the centre less half the radius, is 4 m.
		expect(levelDistances(view, { centre: [3, 4, 0], radius: 2 })).toEqual({
			camera: 3,
			error: 4,
		});
		// A sphere that reaches past the camera measures the least distance.
		expect(levelDistances(view, { centre: [0.5, 0, 0], radius: 2 })).toEqual({
			camera: LEAST_LEVEL_DISTANCE,
			error: LEAST_LEVEL_DISTANCE,
		});
		// A ground 2 km across has a half radius of 707 m. A camera 1,000 m from its centre stands
		// on the surface, so the nearest point caps the error distance near the least.
		const ground = levelDistances(view, { centre: [1000, 1.7, 0], radius: 1_414.2 });
		expect(ground.error).toBeLessThan(0.01);
		// Outside the sphere the cap is twice the distance to the nearest point.
		const outside = levelDistances(view, { centre: [2000, 0, 0], radius: 1_414.2 });
		expect(outside.error).toBeCloseTo(2 * (2000 - 1_414.2), 6);
		// A small sphere keeps the half-radius measure: radius 4 m centred 7 m away measures 5 m.
		expect(levelDistances(view, { centre: [0, 0, -7], radius: 4 }).error).toBeCloseTo(5, 6);
	});

	test('a large object switches by a point halfway into its bounds', () => {
		const view = viewOf(1);
		// Level 1 switches at an error distance of 5 m. A sphere of radius 4 m measures to its centre
		// less 2 m, so it passes at 7.1 m and keeps the base level at 7 m.
		const near = levelDistances(view, { centre: [0, 0, -7], radius: 4 });
		const far = levelDistances(view, { centre: [0, 0, -7.1], radius: 4 });
		expect(levelAt(view, ERRORS, 1, 4, near)).toBe(0);
		expect(levelAt(view, ERRORS, 1, 4, far)).toBe(1);
	});

	test('a bias moves every switch distance together', () => {
		const view = viewOf(1);
		// Level 1 switches at 5 m at a bias of 1, at 2.5 m at 2 and at 10 m at 0.5.
		expect(levelSwitchDistance(view, { error: 0.01 }, 1)).toBeCloseTo(5, 6);
		expect(levelSwitchDistance({ ...view, bias: 2 }, { error: 0.01 }, 1)).toBeCloseTo(2.5, 6);
		expect(levelSwitchDistance({ ...view, bias: 0.5 }, { error: 0.01 }, 1)).toBeCloseTo(10, 6);
		// A bias that is not above 0 reads as 1.
		expect(levelSwitchDistance({ ...view, bias: 0 }, { error: 0.01 }, 1)).toBeCloseTo(5, 6);
	});

	test('a rule without a factor keeps the base level', () => {
		for (const view of [
			{ ...viewOf(1), threshold: 0 },
			{ ...viewOf(1), height: 0 },
		])
			expect(levelAt(view, ERRORS, 1, 0, 1e9)).toBe(0);
		expect(levelAt(viewOf(1), [], 1, 0, 1e9)).toBe(0);
	});
});

/**
 * The Creek ground plants' parts, as the pinned models state them: their two lower levels' errors
 * in the units of the base mesh, the node scale that turns those units into meters, and the switch
 * distances that the showcase's table holds for a copy of scale 1 at 1,080 pixels, a 45 degree
 * field of view and High's one-pixel threshold.
 */
const CREEK_PARTS: readonly {
	readonly name: string;
	readonly errors: readonly [number, number];
	readonly nodeScale: number;
	readonly switches: readonly [number, number];
}[] = [
	{
		name: 'rim-conifer body',
		errors: [218.26374143977176, 253.3543751117608],
		nodeScale: 0.00014248816498264698,
		switches: [40.5, 47.1],
	},
	{
		name: 'rim-conifer tufts',
		errors: [230.69843038920993, 387.9342321069955],
		nodeScale: 0.00023277141465333359,
		switches: [70, 117.7],
	},
	{
		name: 'clipped-shrub body',
		errors: [625.5665872788388, 828.2870198176441],
		nodeScale: 0.00009767145695197658,
		switches: [79.7, 105.5],
	},
	{
		name: 'clipped-shrub tufts',
		errors: [439.376187940806, 706.5392513709147],
		nodeScale: 0.00010742502961120624,
		switches: [61.5, 98.9],
	},
	{
		name: 'azalea body',
		errors: [601.7364573097244, 704.1596840858477],
		nodeScale: 0.00010153946841308095,
		switches: [79.7, 93.2],
	},
	{
		name: 'azalea tufts',
		errors: [425.783947888411, 664.8985240512139],
		nodeScale: 0.0001124983697425662,
		switches: [62.4, 97.5],
	},
	{
		name: 'autumn-clump body',
		errors: [402.05586670476777, 564.9742392320552],
		nodeScale: 0.00010496053781249195,
		switches: [55, 77.3],
	},
	{
		name: 'autumn-clump tufts',
		errors: [342.32069467543687, 496.5264793051737],
		nodeScale: 0.00012386046376834022,
		switches: [55.3, 80.2],
	},
	{
		name: 'moss-cushion body',
		errors: [205.04473995537793, 434.01136623888334],
		nodeScale: 0.00008778571936991497,
		switches: [23.5, 49.7],
	},
	{
		name: 'fern',
		errors: [174.0882540411963, 518.5409492029215],
		nodeScale: 0.00010741678180984472,
		switches: [24.4, 72.6],
	},
	{
		name: 'hosta',
		errors: [220.7641918859763, 978.0692045581228],
		nodeScale: 0.00007156957776993395,
		switches: [20.6, 91.3],
	},
];

describe('the Creek models', () => {
	test('the rule gives the switch distances that the showcase draws', () => {
		const view = { height: 1080, fov: 45, threshold: 1 } as const;
		for (const part of CREEK_PARTS) {
			// A copy of scale 1 has the node's own scale.
			for (const k of [0, 1])
				expect(
					levelSwitchDistance(view, { error: part.errors[k] as number }, part.nodeScale),
					`${part.name} level ${k + 1}`,
				).toBeCloseTo(part.switches[k] as number, 1);
		}
	});
});
