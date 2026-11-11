import { describe, expect, it } from 'bun:test';
import { meadowGrassRecord } from '../grow/ground.fixture';
import { record as template } from '../species/_template/record';
import { capProblems, capsFor, MODEL_CAPS } from './caps';
import { checkSpecies, speciesProblems } from './check';
import type { ShootSpec, Species } from './record';
import type { Spread } from './types';

describe('the record check', () => {
	it('passes the template', () => {
		expect(speciesProblems(template)).toEqual([]);
		expect(checkSpecies(template)).toBe(template);
	});

	it('names every problem at once', () => {
		const broken = {
			...template,
			id: 'Bad Id',
			variants: 9,
			envelope: undefined,
			size: { ...template.size, height: { mean: 1, spread: 2 } },
			lod: { ...template.lod, woodOrders: [1, 2] },
			cuttings: { branch: { shoot: 'none' }, subbranch: { order: 2, length: 0 } },
		} as unknown as Species;
		const problems = speciesProblems(broken);
		expect(problems.some((p) => p.startsWith("id 'Bad Id'"))).toBe(true);
		expect(problems.some((p) => p.startsWith('variants is 9'))).toBe(true);
		expect(problems.some((p) => p.includes('needs an envelope'))).toBe(true);
		expect(problems.some((p) => p.startsWith('size.height can draw'))).toBe(true);
		expect(problems.some((p) => p.startsWith('lod.woodOrders'))).toBe(true);
		expect(problems.some((p) => p.startsWith("cuttings.branch.shoot 'none'"))).toBe(true);
		expect(problems.some((p) => p.startsWith('cuttings.subbranch.length is 0'))).toBe(true);
		expect(() => checkSpecies(broken)).toThrow(/cannot grow/);
	});

	it('holds the flutter by height to a non-negative share', () => {
		const withCurve = (byHeight: readonly (readonly [number, number])[]): Species => ({
			...template,
			wind: { ...template.wind, flutter: { ...template.wind.flutter, byHeight } },
		});
		expect(
			speciesProblems(
				withCurve([
					[0, 2],
					[1, 0.5],
				]),
			),
		).toEqual([]);
		expect(
			speciesProblems(
				withCurve([
					[0, 2],
					[1, -0.5],
				]),
			).some((p) => p.startsWith('wind.flutter.byHeight')),
		).toBe(true);
		expect(
			speciesProblems(
				withCurve([
					[0.5, 1],
					[0.2, 2],
				]),
			).some((p) => p.startsWith('wind.flutter.byHeight')),
		).toBe(true);
	});

	it('holds a season bark tint to non-negative channels', () => {
		const out = {
			...template,
			seasons: {
				...template.seasons,
				bark: { autumn: [1.2, -0.1, 0.9] as [number, number, number] },
			},
		} as Species;
		expect(speciesProblems(out).some((p) => p.startsWith('seasons.bark.autumn[1]'))).toBe(true);
	});

	it('draws a winter stand its own leaf colours, and names any other season a problem', () => {
		const colours = {
			reflectance: [0.2, 0.1, 0.05] as [number, number, number],
			transmittance: [0.2, 0.1, 0.05] as [number, number, number],
		};
		const winter = {
			...template,
			seasons: { ...template.seasons, leaves: { winter: colours } },
		} as Species;
		expect(speciesProblems(winter).some((p) => p.startsWith('seasons.leaves'))).toBe(false);
		const summer = {
			...template,
			seasons: { ...template.seasons, leaves: { summer: colours } },
		} as Species;
		expect(speciesProblems(summer).some((p) => p.startsWith('seasons.leaves names summer'))).toBe(
			true,
		);
	});

	it('holds the sway power to its range', () => {
		const out = {
			...template,
			wind: { ...template.wind, sway: { frequency: 0.4, amplitude: 0.05, power: 9 } },
		} as Species;
		expect(speciesProblems(out).some((p) => p.startsWith('wind.sway.power is 9'))).toBe(true);
		const fine = {
			...template,
			wind: { ...template.wind, sway: { frequency: 0.4, amplitude: 0.05, power: 3 } },
		} as Species;
		expect(speciesProblems(fine)).toEqual([]);
	});

	it('holds the crown fields to their ranges', () => {
		if (template.growth.model !== 'self-organizing' || !template.shoots)
			throw new Error('the template grows by the self-organizing model, with shoots');
		const growth = template.growth;
		const shoots = template.shoots;
		const out = {
			...template,
			growth: { ...growth, floor: 0.6, turning: 120 },
			shoots: {
				...shoots,
				placement: {
					...shoots.placement,
					skyPrune: 1.5,
					skyPruneLayer: 10,
					gather: 1.5,
					reach: 90,
					bareTrim: 0.5,
					lift: 45,
					tipPrune: 1.5,
					limbMass: { order: 9, hold: -1, reach: -2, depth: 1.5 },
				},
			},
		} as Species;
		const problems = speciesProblems(out);
		expect(problems.some((p) => p.startsWith('growth.floor is 0.6'))).toBe(true);
		expect(problems.some((p) => p.startsWith('growth.turning is 120'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.skyPrune is 1.5'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.skyPruneLayer is 10'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.gather is 1.5'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.reach is 90'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.bareTrim is 0.5'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.lift is 45'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.tipPrune is 1.5'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.limbMass.order is 9'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.limbMass.hold is -1'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.limbMass.reach is -2'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.placement.limbMass.depth is 1.5'))).toBe(true);
		const within = {
			...template,
			growth: { ...growth, floor: 0.15, turning: 30 },
			shoots: {
				...shoots,
				placement: {
					...shoots.placement,
					skyPrune: 0.15,
					skyPruneLayer: 1,
					bareTrim: 0.03,
					lift: -30,
					tipPrune: 0.05,
					limbMass: { order: 2, hold: 1.5, reach: 3.5, depth: 1 },
				},
			},
		} as Species;
		expect(speciesProblems(within)).toEqual([]);
		const withStalk = (cardStalk: number): Species => ({
			...template,
			lod: { ...template.lod, cardStalk },
		});
		for (const cardStalk of [0, 1, 8]) expect(speciesProblems(withStalk(cardStalk))).toEqual([]);
		for (const cardStalk of [-1, 8.1, Number.NaN])
			expect(speciesProblems(withStalk(cardStalk)).some((p) => p.startsWith('lod.cardStalk'))).toBe(
				true,
			);
		const withTurning = (turning: number): Species => ({
			...within,
			growth: { ...growth, floor: 0.15, turning },
		});
		for (const turning of [0, 90]) expect(speciesProblems(withTurning(turning))).toEqual([]);
		for (const turning of [-1, 90.1, Number.NaN])
			expect(
				speciesProblems(withTurning(turning)).some((p) => p.startsWith('growth.turning')),
			).toBe(true);
		const withThickness = (clearanceThickness: number): Species => ({
			...within,
			growth: { ...growth, floor: 0.15, clearanceThickness },
		});
		for (const clearanceThickness of [0, 0.35, 1])
			expect(speciesProblems(withThickness(clearanceThickness))).toEqual([]);
		for (const clearanceThickness of [-0.1, 1.1, Number.NaN])
			expect(
				speciesProblems(withThickness(clearanceThickness)).some((p) =>
					p.startsWith('growth.clearanceThickness'),
				),
			).toBe(true);
		for (const tipPrune of [-0.1, Number.NaN]) {
			const tip = {
				...template,
				shoots: { ...shoots, placement: { ...shoots.placement, tipPrune } },
			} as Species;
			expect(speciesProblems(tip).some((p) => p.startsWith('shoots.placement.tipPrune'))).toBe(
				true,
			);
		}
	});

	it('holds the stem base and the bend to their ranges', () => {
		const growth = template.growth;
		if (growth.model !== 'self-organizing') throw new Error('the template grows self-organizing');
		const bent = {
			...template,
			growth: { ...growth, bending: { strength: -0.1, upturn: 1.5, girth: 0 } },
			base: {
				flare: { amount: -0.2, height: 0.4 },
				taper: { amount: -0.1, height: 0 },
				buttress: { lobes: 5, amount: 0.5, sharpness: 0, height: 0 },
				roots: {
					count: 4,
					length: { mean: 0.2, spread: 0.3 },
					radius: -0.1,
					dive: 0.2,
					ridge: 1.2,
				},
				flutes: { count: 6, depth: 0.05, height: 0 },
			},
		} as Species;
		const problems = speciesProblems(bent);
		for (const path of [
			'growth.bending.strength is -0.1',
			'growth.bending.upturn is 1.5',
			'growth.bending.girth is 0',
			'base.flare.amount is -0.2',
			'base.taper.amount is -0.1',
			'base.taper.height is 0',
			'base.buttress.sharpness is 0',
			'base.buttress.height is 0',
			'base.roots.length can draw',
			'base.roots.radius is -0.1',
			'base.roots.ridge is 1.2',
			'base.flutes.height is 0',
		])
			expect(problems.some((p) => p.startsWith(path))).toBe(true);
		const bark = template.bark as NonNullable<Species['bark']>;
		const forked = (fork: NonNullable<Species['bark']>['fork']): Species => ({
			...template,
			bark: { ...bark, fork },
		});
		expect(speciesProblems(forked({ bend: 3, knot: 0.2 }))).toEqual([]);
		expect(
			speciesProblems(forked({ bend: 0 })).some((p) => p.startsWith('bark.fork.bend is 0')),
		).toBe(true);
		for (const knot of [-0.1, 1.5])
			expect(
				speciesProblems(forked({ knot })).some((p) => p.startsWith(`bark.fork.knot is ${knot}`)),
			).toBe(true);
		const fine = { ...template, base: { flare: { amount: 0.6, height: 0.4 } } } as Species;
		expect(speciesProblems(fine)).toEqual([]);
	});

	it("holds an extra's band colour, roughness and stalk faces, and its band to a scaled lathe", () => {
		const acorn = {
			kind: 'fruit' as const,
			at: 'shoot-tip' as const,
			share: 0.05,
			seasons: ['summer' as const],
			shape: {
				lathe: [
					[0.005, 0],
					[0.007, 0.007],
					[0, 0.02],
				] as [number, number][],
				scaled: [0, 0.007] as [number, number],
			},
			colour: [0.24, 0.1, 0.03] as [number, number, number],
			hang: 180,
		};
		const good: Species = {
			...template,
			extras: [
				{
					...acorn,
					shape: { ...acorn.shape, stalkSides: 5 },
					bandColour: [0.3, 0.23, 0.15],
					roughness: [0.35, 0.85],
				},
			],
		};
		expect(speciesProblems(good)).toEqual([]);
		const bad: Species = {
			...template,
			extras: [
				{ ...acorn, bandColour: [1.2, 0.2, 0.1], roughness: [-0.1, 0.5] },
				{ ...acorn, shape: { lathe: acorn.shape.lathe }, bandColour: [0.3, 0.2, 0.1] },
				{ ...acorn, shape: { ...acorn.shape, stalkSides: 2.5 } },
			],
		};
		const problems = speciesProblems(bad);
		expect(problems.some((p) => p.startsWith('extras[0].bandColour[0] is 1.2'))).toBe(true);
		expect(problems.some((p) => p.startsWith('extras[0].roughness[0] is -0.1'))).toBe(true);
		expect(
			problems.some((p) => p.startsWith("extras[1].bandColour needs a lathe whose 'scaled'")),
		).toBe(true);
		expect(
			problems.some((p) => p.startsWith('extras[2].shape.stalkSides is 2.5; it must be a whole')),
		).toBe(true);
		expect(speciesProblems({ ...template, extras: [{ ...acorn, group: 3 }] })).toEqual([]);
		expect(
			speciesProblems({ ...template, extras: [{ ...acorn, group: 2.5 }] }).some((p) =>
				p.startsWith('extras[0].group is 2.5; it must be a whole number from 0 to 15'),
			),
		).toBe(true);
	});

	it('presses a blade, a thick leaf or a whole frond flat, and no other foliage', () => {
		const pressed: Species = { ...template, cuttings: { leaf: { pressed: true } } };
		const flat = template.foliage.kind === 'blade' || template.foliage.kind === 'thick';
		expect(speciesProblems(pressed).some((p) => p.startsWith('cuttings.leaf.pressed'))).toBe(!flat);
		const needled = {
			...pressed,
			foliage: { kind: 'none' },
		} as unknown as Species;
		expect(
			speciesProblems(needled).some((p) => p.startsWith('cuttings.leaf.pressed lays a leaf')),
		).toBe(true);
		const frond = {
			...pressed,
			foliage: { kind: 'frond', optics: {} },
		} as unknown as Species;
		expect(speciesProblems(frond).some((p) => p.startsWith('cuttings.leaf.pressed'))).toBe(false);
	});

	it('holds a pressed leaf own stalk to a length above zero', () => {
		const short: Species = { ...template, cuttings: { leaf: { pressed: true, petiole: 0 } } };
		expect(speciesProblems(short).some((p) => p.startsWith('cuttings.leaf.petiole is 0'))).toBe(
			true,
		);
		const kept: Species = { ...template, cuttings: { leaf: { pressed: true, petiole: 0.04 } } };
		expect(speciesProblems(kept).some((p) => p.startsWith('cuttings.leaf.petiole'))).toBe(false);
	});

	it("holds a compound leaf's leaflet angle and stalk to their ranges", () => {
		const foliage = template.foliage;
		if (foliage.kind !== 'blade') return;
		const compound = foliage.compound;
		if (!compound) return;
		const out = (angle: number, leafletStalk: number): Species => ({
			...template,
			foliage: {
				...foliage,
				compound: { ...compound, angle, leafletStalk },
			},
		});
		expect(
			speciesProblems(out(100, 1.5)).some((p) => p.startsWith('foliage.compound.angle is 100')),
		).toBe(true);
		expect(
			speciesProblems(out(100, 1.5)).some((p) =>
				p.startsWith('foliage.compound.leafletStalk is 1.5'),
			),
		).toBe(true);
		expect(speciesProblems(out(62, 0))).toEqual(speciesProblems(template));
	});

	it("holds a bark zone's tint to factors from 0", () => {
		const bark = template.bark as NonNullable<Species['bark']>;
		const tinted = (tint: [number, number, number]): Species => ({
			...template,
			bark: { ...bark, zones: bark.zones.map((zone) => ({ ...zone, tint })) },
		});
		expect(speciesProblems(tinted([1.04, 1.02, 0.94]))).toEqual([]);
		expect(speciesProblems(tinted([0, 0, 0]))).toEqual([]);
		for (const channel of [-0.1, Number.NaN])
			expect(
				speciesProblems(tinted([1, channel, 1])).some((p) => p.startsWith('bark.zones[0].tint[1]')),
			).toBe(true);
	});

	it("holds a tip cluster's step to a share and its lean to 0 to 80 degrees", () => {
		const shoots = template.shoots;
		if (!shoots) throw new Error('the template has no shoots');
		const bunched = (step: number, lean: number): Species => ({
			...template,
			shoots: { ...shoots, bud: { ...shoots.bud, cluster: { step, lean } } },
		});
		expect(speciesProblems(bunched(0.15, 50))).toEqual([]);
		const problems = [...speciesProblems(bunched(1.5, 50)), ...speciesProblems(bunched(0.2, 90))];
		expect(problems.some((p) => p.startsWith('shoots.bud.cluster.step is 1.5'))).toBe(true);
		expect(problems.some((p) => p.startsWith('shoots.bud.cluster.lean is 90'))).toBe(true);
		expect(
			speciesProblems(bunched(Number.NaN, 50)).some((p) => p.startsWith('shoots.bud.cluster.step')),
		).toBe(true);
	});

	it('keeps a cutting class off the crown classes', () => {
		const shoots = template.shoots;
		if (!shoots) throw new Error('the template has no shoots');
		const crown = shoots.classes[0];
		if (!crown) throw new Error('the template has no crown class');
		const withCutting = (name: (typeof crown)['name']): Species => ({
			...template,
			shoots: { ...shoots, cuttingClasses: [{ ...crown, name }] },
		});
		// A separate name is the point of the field, so it passes; naming a crown class is refused.
		expect(speciesProblems(withCutting('cut'))).toEqual([]);
		expect(
			speciesProblems(withCutting(crown.name)).some((problem) =>
				problem.startsWith(`shoots.cuttingClasses names '${crown.name}'`),
			),
		).toBe(true);
	});

	it("holds a class's own arrangement and facing inside their ranges", () => {
		const shoots = template.shoots;
		if (!shoots) throw new Error('the template has no shoots');
		const crown = shoots.classes[0];
		if (!crown) throw new Error('the template has no crown class');
		const withClass = (fields: Partial<typeof crown>): Species => ({
			...template,
			shoots: { ...shoots, classes: [{ ...crown, ...fields }, ...shoots.classes.slice(1)] },
		});
		// A cutting class takes the same checks, so a bad value is refused there too.
		const withCutting = (fields: Partial<typeof crown>): Species => ({
			...template,
			shoots: { ...shoots, cuttingClasses: [{ ...crown, name: 'cut', ...fields }] },
		});
		expect(speciesProblems(withClass({ skyward: 0.4 }))).toEqual([]);
		expect(
			speciesProblems(withClass({ skyward: 1.4 })).some((problem) => problem.includes('skyward')),
		).toBe(true);
		expect(
			speciesProblems(withClass({ phyllotaxis: { kind: 'spiral', divergence: 400 } })).some(
				(problem) => problem.includes('phyllotaxis.divergence'),
			),
		).toBe(true);
		expect(
			speciesProblems(withCutting({ skyward: -0.2 })).some((problem) =>
				problem.startsWith('shoots.cuttingClasses[0].skyward'),
			),
		).toBe(true);
	});

	it("holds a cup's scale shade from 0 to 1", () => {
		const lathe: [number, number][] = [
			[0.005, 0],
			[0.007, 0.007],
			[0, 0.02],
		];
		const cup = (scaleShade: number): Species => ({
			...template,
			extras: [
				{
					kind: 'fruit',
					at: 'shoot-tip',
					share: 0.05,
					seasons: ['summer'],
					shape: { lathe, scaled: [0, 0.007], scaleShade },
					colour: [0.24, 0.1, 0.03],
					bandColour: [0.3, 0.23, 0.15],
					hang: 180,
				},
			],
		});
		expect(speciesProblems(cup(0.6))).toEqual([]);
		for (const shade of [1.5, -0.1, Number.NaN])
			expect(
				speciesProblems(cup(shade)).some((p) => p.startsWith('extras[0].shape.scaleShade')),
			).toBe(true);
	});

	it('holds a budget to its model caps, and lets the owner name larger downloads', () => {
		const greedy: Species = {
			...template,
			lod: { ...template.lod, budget: { ...template.lod.budget, lod1Triangles: 200_000 } },
		};
		expect(capProblems(greedy)).toHaveLength(1);
		expect(capsFor(template)).toBe(MODEL_CAPS.tree);
		expect(capsFor({ ...template, id: 'silver-birch' }).downloadBytes).toBe(1_300_000);
	});

	it("keeps a shoot class's side shoots per joint and their gap in range", () => {
		const shoots = template.shoots as ShootSpec;
		const jointed = (laterals: Spread, lateralGap?: number): Species => ({
			...template,
			shoots: {
				...shoots,
				classes: shoots.classes.map((c) => ({
					...c,
					laterals,
					...(lateralGap !== undefined && { lateralGap }),
				})),
			},
		});
		expect(speciesProblems(jointed({ mean: 1.6, spread: 0.4 }, 0.3))).toEqual([]);
		const problems = (record: Species) => speciesProblems(record).join('\n');
		expect(problems(jointed({ mean: 2.8, spread: 0.5 }))).toContain('.laterals draws 2.3 to 3.3');
		expect(problems(jointed(-1))).toContain('.laterals draws -1 to -1');
		expect(problems(jointed({ mean: 1, spread: -0.2 }))).toContain('.laterals.spread is -0.2');
		expect(problems(jointed(1, 0.6))).toContain('.lateralGap is 0.6');
		const bent = (bend: { length: number; angle: number }): Species => ({
			...template,
			shoots: { ...shoots, classes: shoots.classes.map((c) => ({ ...c, bend })) },
		});
		expect(speciesProblems(bent({ length: 0.05, angle: 34 }))).toEqual([]);
		expect(problems(bent({ length: 0.001, angle: 20 }))).toContain('.bend.length is 0.001');
		expect(problems(bent({ length: 0.05, angle: 90 }))).toContain('.bend.angle is 90');
		const leafy = (leafYears: number): Species => ({
			...template,
			shoots: { ...shoots, classes: shoots.classes.map((c) => ({ ...c, years: 2, leafYears })) },
		});
		expect(speciesProblems(leafy(1))).toEqual([]);
		expect(problems(leafy(3))).toContain('.leafYears is 3');
		expect(problems(leafy(-1))).toContain('.leafYears is -1');
		const held = (lateralMost: number): Species => ({
			...template,
			shoots: { ...shoots, classes: shoots.classes.map((c) => ({ ...c, lateralMost })) },
		});
		expect(speciesProblems(held(65))).toEqual([]);
		expect(problems(held(200))).toContain('.lateralMost is 200');
		expect(problems(held(-5))).toContain('.lateralMost is -5');
	});
});

describe('a tuft sheath colour', () => {
	const withColour = (sheathColour: readonly [number, number, number]): Species => {
		const growth = meadowGrassRecord.growth;
		if (growth.model !== 'tuft') throw new Error('the meadow grass is a tuft');
		return { ...meadowGrassRecord, growth: { ...growth, sheathColour } };
	};

	it('reads a colour as three shares from 0 to 1', () => {
		expect(speciesProblems(meadowGrassRecord)).toEqual([]);
		expect(speciesProblems(withColour([0.366, 0.38, 0.309]))).toEqual([]);
		const problems = speciesProblems(withColour([0.366, 1.38, -0.1]));
		expect(problems.some((p) => p.startsWith('growth.sheathColour.1'))).toBe(true);
		expect(problems.some((p) => p.startsWith('growth.sheathColour.2'))).toBe(true);
		expect(problems.some((p) => p.startsWith('growth.sheathColour.0'))).toBe(false);
	});
});
