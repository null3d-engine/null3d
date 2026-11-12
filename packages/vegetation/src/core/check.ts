// The record check: every problem with a species record, found at once, so a worker fixes them in
// one pass. It checks what any record must hold (names, numbers in their ranges, curves that rise,
// the envelope a self-organizing plant needs, shoot classes whose shares add up, the detail levels
// and the budget under the owner's caps). Each grower may hold its model's finer rules beside it.
import { capProblems } from './caps';
import { FORM_FIELDS, formRecord } from './forms';
import type { BaseSpec, Envelope, GrowthModel, ShootClass, ShootSpec, Species } from './record';
import {
	BEND_PIECE_LEAST,
	type Curve,
	LATERAL_GAP_MOST,
	SIDE_SHOOTS_MOST,
	type Spread,
	spreadMean,
} from './types';

const MODELS: readonly GrowthModel[] = [
	'self-organizing',
	'architectural',
	'crown-rosette',
	'culm',
	'rosette',
	'frond-colony',
	'tuft',
	'column',
];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEASONS = ['summer', 'autumn', 'winter', 'blossom'];

/** Every number in a value that is not finite, by its path. */
function nonFinite(value: unknown, path: string, out: string[]): void {
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) out.push(`${path} is ${value}; every number must be finite`);
	} else if (Array.isArray(value)) {
		value.forEach((item, i) => {
			nonFinite(item, `${path}[${i}]`, out);
		});
	} else if (value && typeof value === 'object') {
		for (const [key, item] of Object.entries(value)) nonFinite(item, `${path}.${key}`, out);
	}
}

/** A curve's problems: its pairs' t must rise. */
function curveProblems(curve: Curve, path: string, out: string[]): void {
	if (typeof curve === 'number') return;
	if (curve.length === 0) out.push(`${path} has no pairs`);
	for (let i = 1; i < curve.length; i++)
		if (
			((curve[i] as readonly number[])[0] as number) <
			((curve[i - 1] as readonly number[])[0] as number)
		)
			out.push(`${path} has t falling at pair ${i}; a curve's t rises`);
}

/** A spread's problems: its half-width is not negative and leaves the value positive when it must. */
function spreadProblems(spread: Spread, path: string, positive: boolean, out: string[]): void {
	const mean = typeof spread === 'number' ? spread : spread.mean;
	const half = typeof spread === 'number' ? 0 : spread.spread;
	if (half < 0) out.push(`${path}.spread is ${half}; a spread's half-width is not negative`);
	if (positive && mean - half <= 0)
		out.push(`${path} can draw ${mean - half}; it must stay above 0`);
}

/** A species' sparse floors' problems: each share from 0.05 to 1, and the coarsening from 0 to 1. */
function sparseProblems(record: Species, out: string[]): void {
	const sparse = record.sparse;
	if (!sparse) return;
	for (const key of ['limbs', 'leaves'] as const) {
		const value = sparse[key];
		if (value < 0.05 || value > 1)
			out.push(`sparse.${key} is ${value}; a sparse floor lies from 0.05 to 1`);
	}
	if (sparse.coarseness < 0 || sparse.coarseness > 1)
		out.push(`sparse.coarseness is ${sparse.coarseness}; it lies from 0 to 1`);
}

/** A share's problems: it lies from 0 to 1. */
function shareProblem(value: number | undefined, path: string, out: string[]): void {
	if (value === undefined) return;
	if (value < 0 || value > 1) out.push(`${path} is ${value}; a share lies from 0 to 1`);
}

/** A whole number's problems: it is whole and within its range. */
function wholeProblem(value: number, path: string, low: number, high: number, out: string[]): void {
	if (!Number.isInteger(value) || value < low || value > high)
		out.push(`${path} is ${value}; it must be a whole number from ${low} to ${high}`);
}

function envelopeProblems(envelope: Envelope, out: string[]): void {
	if (envelope.kind !== 'radial') return;
	const { heights, radii } = envelope;
	if (heights.length < 2) out.push('envelope.heights needs at least two heights');
	if (radii.length !== heights.length)
		out.push(
			`envelope.radii has ${radii.length} entries for ${heights.length} heights; give one per height`,
		);
	for (let i = 0; i < heights.length; i++) {
		const h = heights[i] as number;
		if (h < 0 || h > 1)
			out.push(`envelope.heights[${i}] is ${h}; heights are shares of the height`);
		if (i > 0 && h <= (heights[i - 1] as number))
			out.push(`envelope.heights[${i}] does not rise above the one before`);
	}
	radii.forEach((radius, i) => {
		const values = typeof radius === 'number' ? [radius] : radius;
		if (typeof radius !== 'number' && values.length !== 8 && values.length !== 16)
			out.push(`envelope.radii[${i}] has ${values.length} azimuths; give 1, 8 or 16`);
		for (const value of values)
			if (value < 0) out.push(`envelope.radii[${i}] holds ${value}; a radius is not negative`);
	});
}

/** A non-negative number's problem: metres, shares and amounts that cannot fall below zero. */
function notNegative(value: number, path: string, out: string[]): void {
	if (!(value >= 0)) out.push(`${path} is ${value}; it cannot be below 0`);
}

/** The stem base's problems: amounts and depths from 0, heights of fade above 0. */
function baseProblems(base: BaseSpec, out: string[]): void {
	notNegative(base.flare.amount, 'base.flare.amount', out);
	notNegative(base.flare.height, 'base.flare.height', out);
	if (base.taper) {
		notNegative(base.taper.amount, 'base.taper.amount', out);
		if (!(base.taper.height > 0))
			out.push(`base.taper.height is ${base.taper.height}; it must be above 0`);
	}
	const buttress = base.buttress;
	if (buttress) {
		spreadProblems(buttress.lobes, 'base.buttress.lobes', false, out);
		notNegative(buttress.amount, 'base.buttress.amount', out);
		if (!(buttress.sharpness > 0))
			out.push(`base.buttress.sharpness is ${buttress.sharpness}; it must be above 0`);
		if (!(buttress.height > 0))
			out.push(`base.buttress.height is ${buttress.height}; it is metres and must be above 0`);
		shareProblem(buttress.round, 'base.buttress.round', out);
	}
	const roots = base.roots;
	if (roots) {
		spreadProblems(roots.count, 'base.roots.count', false, out);
		spreadProblems(roots.length, 'base.roots.length', true, out);
		notNegative(roots.radius, 'base.roots.radius', out);
		notNegative(roots.dive, 'base.roots.dive', out);
		if (roots.ridge !== undefined && !(roots.ridge >= 0 && roots.ridge <= 1))
			out.push(`base.roots.ridge is ${roots.ridge}; it is a share from 0 to 1`);
	}
	const flutes = base.flutes;
	if (flutes) {
		spreadProblems(flutes.count, 'base.flutes.count', false, out);
		notNegative(flutes.depth, 'base.flutes.depth', out);
		if (!(flutes.height > 0))
			out.push(`base.flutes.height is ${flutes.height}; it is metres and must be above 0`);
	}
}

/**
 * The checks one shoot class takes, whether it draws the crown or a cutting: its ranges, its
 * years, its joints and its own leaf arrangement and facing.
 */
function shootClassProblems(
	shoot: ShootClass,
	path: string,
	speciesYears: number,
	out: string[],
): void {
	const [low, high] = shoot.vigor;
	if (low < 0 || high > 1 || low > high)
		out.push(`${path}.vigor is [${low}, ${high}]; give a rising range within 0 to 1`);
	spreadProblems(shoot.length, `${path}.length`, true, out);
	spreadProblems(shoot.nodes, `${path}.nodes`, true, out);
	curveProblems(shoot.internode, `${path}.internode`, out);
	curveProblems(shoot.leafScale, `${path}.leafScale`, out);
	curveProblems(shoot.leafAngle, `${path}.leafAngle`, out);
	if (shoot.years !== undefined) wholeProblem(shoot.years, `${path}.years`, 1, 3, out);
	if (shoot.laterals !== undefined) {
		spreadProblems(shoot.laterals, `${path}.laterals`, false, out);
		const mean = spreadMean(shoot.laterals);
		const half = typeof shoot.laterals === 'number' ? 0 : shoot.laterals.spread;
		if (mean - half < 0 || mean + half > SIDE_SHOOTS_MOST)
			out.push(
				`${path}.laterals draws ${mean - half} to ${mean + half}; a joint carries 0 to ${SIDE_SHOOTS_MOST} side shoots`,
			);
	}
	if (
		shoot.lateralGap !== undefined &&
		!(shoot.lateralGap >= 0 && shoot.lateralGap <= LATERAL_GAP_MOST)
	)
		out.push(
			`${path}.lateralGap is ${shoot.lateralGap}; it is a share of a unit from 0 to ${LATERAL_GAP_MOST}`,
		);
	if (shoot.lateralMost !== undefined && !(shoot.lateralMost >= 0 && shoot.lateralMost <= 180))
		out.push(`${path}.lateralMost is ${shoot.lateralMost}; it is degrees from 0 to 180`);
	if (shoot.leafYears !== undefined)
		wholeProblem(shoot.leafYears, `${path}.leafYears`, 0, shoot.years ?? speciesYears, out);
	if (shoot.bend !== undefined) {
		if (!(shoot.bend.length >= BEND_PIECE_LEAST))
			out.push(
				`${path}.bend.length is ${shoot.bend.length}; a piece is at least ${BEND_PIECE_LEAST} m`,
			);
		if (!(shoot.bend.angle >= 0 && shoot.bend.angle <= 60))
			out.push(`${path}.bend.angle is ${shoot.bend.angle}; it is degrees from 0 to 60`);
	}
	if (shoot.skyward !== undefined) shareProblem(shoot.skyward, `${path}.skyward`, out);
	if (shoot.phyllotaxis?.kind === 'spiral')
		wholeProblem(shoot.phyllotaxis.divergence, `${path}.phyllotaxis.divergence`, 0, 360, out);
	else if (shoot.phyllotaxis?.kind === 'distichous') {
		shareProblem(shoot.phyllotaxis.flatten, `${path}.phyllotaxis.flatten`, out);
		if (shoot.phyllotaxis.turn !== undefined)
			wholeProblem(shoot.phyllotaxis.turn, `${path}.phyllotaxis.turn`, 0, 180, out);
	}
}

function shootProblems(shoots: ShootSpec, out: string[]): void {
	wholeProblem(shoots.prototypes, 'shoots.prototypes', 4, 12, out);
	wholeProblem(shoots.orders, 'shoots.orders', 1, 3, out);
	const cluster = shoots.bud.cluster;
	if (cluster && !(cluster.step >= 0 && cluster.step <= 1))
		out.push(
			`shoots.bud.cluster.step is ${cluster.step}; it is a share of a bud's length from 0 to 1`,
		);
	if (cluster && !(cluster.lean >= 0 && cluster.lean <= 80))
		out.push(`shoots.bud.cluster.lean is ${cluster.lean}; it is degrees from 0 to 80`);
	if (shoots.leafYears > shoots.years)
		out.push(`shoots.leafYears is ${shoots.leafYears}, more than shoots.years (${shoots.years})`);
	if (shoots.classes.length === 0) out.push('shoots.classes is empty; give at least one class');
	let share = 0;
	shoots.classes.forEach((shoot, i) => {
		const path = `shoots.classes[${i}]`;
		share += shoot.share;
		shootClassProblems(shoot, path, shoots.years, out);
	});
	(shoots.cuttingClasses ?? []).forEach((shoot, i) => {
		shootClassProblems(shoot, `shoots.cuttingClasses[${i}]`, shoots.years, out);
	});
	if (shoots.classes.length > 0 && Math.abs(share - 1) > 0.01)
		out.push(`shoots.classes' shares add up to ${share}; they must add up to 1`);
	const crowns = new Set(shoots.classes.map((shoot) => shoot.name));
	for (const cutting of shoots.cuttingClasses ?? [])
		if (crowns.has(cutting.name))
			out.push(`shoots.cuttingClasses names '${cutting.name}', which is also a crown class`);
	curveProblems(shoots.placement.perMetre, 'shoots.placement.perMetre', out);
	shareProblem(shoots.placement.shadePrune, 'shoots.placement.shadePrune', out);
	const tip = shoots.placement.tipPrune;
	if (tip !== undefined && !(tip >= 0 && tip <= 1))
		out.push(`shoots.placement.tipPrune is ${tip}; a share lies from 0 to 1`);
	shareProblem(shoots.placement.skyPrune, 'shoots.placement.skyPrune', out);
	const layer = shoots.placement.skyPruneLayer;
	if (layer !== undefined && !(layer >= 0.25 && layer <= 5))
		out.push(`shoots.placement.skyPruneLayer is ${layer}; it is metres from 0.25 to 5`);
	const trim = shoots.placement.bareTrim;
	if (trim !== undefined && !(trim >= 0 && trim <= 0.1))
		out.push(
			`shoots.placement.bareTrim is ${trim}; it is a radius in metres from 0 to 0.1, a twig's wood`,
		);
	const bole = shoots.placement.bareBole;
	if (bole !== undefined) {
		if (!(bole.radius > 0))
			out.push(
				`shoots.placement.bareBole.radius is ${bole.radius}; it is a radius in metres above 0`,
			);
		shareProblem(bole.height, 'shoots.placement.bareBole.height', out);
	}
	const lift = shoots.placement.lift;
	if (lift !== undefined && !(lift >= -30 && lift <= 30))
		out.push(`shoots.placement.lift is ${lift}; it is degrees from -30 to 30`);
	shareProblem(shoots.placement.skyward, 'shoots.placement.skyward', out);
	if (shoots.placement.reach !== undefined)
		wholeProblem(shoots.placement.reach, 'shoots.placement.reach', 0, 60, out);
	shareProblem(shoots.placement.gather, 'shoots.placement.gather', out);
	spreadProblems(shoots.placement.scale, 'shoots.placement.scale', true, out);
	const clump = shoots.placement.clump;
	for (const [name, scale] of [
		['clump', clump],
		['clump.fine', clump?.fine],
	] as const) {
		if (!scale) continue;
		if (!(scale.spacing > 0))
			out.push(
				`shoots.placement.${name}.spacing is ${scale.spacing}; it is metres and must be above 0`,
			);
		shareProblem(scale.depth, `shoots.placement.${name}.depth`, out);
	}
}

function growthProblems(record: Species, out: string[]): void {
	const growth = record.growth;
	if (!MODELS.includes(growth.model)) {
		out.push(`growth.model is '${String(growth.model)}'; use one of ${MODELS.join(', ')}`);
		return;
	}
	if (growth.model === 'self-organizing') {
		if (!record.envelope) out.push('a self-organizing species needs an envelope');
		if (growth.years < 1) out.push(`growth.years is ${growth.years}; grow at least one cycle`);
		wholeProblem(growth.macroOrders, 'growth.macroOrders', 2, 4, out);
		if (growth.branching !== undefined && !(growth.branching >= 0))
			out.push(
				`growth.branching is ${growth.branching}; it multiplies a chance and cannot be below 0`,
			);
		if (growth.clearance !== undefined && !(growth.clearance >= 0 && growth.clearance <= 2))
			out.push(`growth.clearance is ${growth.clearance}; it is metres of clear air from 0 to 2`);
		if (growth.turning !== undefined && !(growth.turning >= 0 && growth.turning <= 90))
			out.push(`growth.turning is ${growth.turning}; it is degrees from 0 to 90`);
		const thickness = growth.clearanceThickness;
		if (thickness !== undefined && !(thickness >= 0 && thickness <= 1))
			out.push(`growth.clearanceThickness is ${thickness}; it is a share from 0 to 1`);
		if (growth.floor !== undefined && !(growth.floor >= 0 && growth.floor <= 0.5))
			out.push(
				`growth.floor is ${growth.floor}; it is a share of the height from 0 to 0.5, a crown's underside`,
			);
		wholeProblem(growth.light.cells, 'growth.light.cells', 8, 96, out);
		const roomBias = growth.light.roomBias;
		if (roomBias !== undefined && !(roomBias >= 0 && roomBias <= 4))
			out.push(`growth.light.roomBias is ${roomBias}; it is a power from 0 to 4, 0 for none`);
		if (growth.internode.length <= 0)
			out.push(`growth.internode.length is ${growth.internode.length}; it must be above 0`);
		shareProblem(growth.internode.ageFactor, 'growth.internode.ageFactor', out);
		shareProblem(growth.buds.extinction[0], 'growth.buds.extinction[0]', out);
		shareProblem(growth.buds.extinction[1], 'growth.buds.extinction[1]', out);
		curveProblems(growth.buds.angle, 'growth.buds.angle', out);
		if (growth.buds.sideOrders !== undefined)
			wholeProblem(growth.buds.sideOrders, 'growth.buds.sideOrders', 1, growth.macroOrders, out);
		curveProblems(growth.apical.control, 'growth.apical.control', out);
		curveProblems(growth.tropism.photo, 'growth.tropism.photo', out);
		curveProblems(growth.tropism.gravi, 'growth.tropism.gravi', out);
		shareProblem(growth.shedding.cleanBole, 'growth.shedding.cleanBole', out);
		shareProblem(growth.shedding.stubs, 'growth.shedding.stubs', out);
		shareProblem(growth.shedding.underCrown, 'growth.shedding.underCrown', out);
		spreadProblems(growth.stems.count, 'growth.stems.count', true, out);
		notNegative(growth.bending.strength, 'growth.bending.strength', out);
		shareProblem(growth.bending.upturn, 'growth.bending.upturn', out);
		const plumb = growth.divide?.plumb;
		if (plumb !== undefined && !(plumb >= 0 && plumb <= 90))
			out.push(`growth.divide.plumb is ${plumb}; it is degrees from 0 to 90`);
		const girth = growth.bending.girth;
		if (girth !== undefined && !(girth > 0))
			out.push(`growth.bending.girth is ${girth}; it is metres and must be above 0`);
		if (growth.pipe.exponent <= 0 || growth.pipe.tipRadius <= 0)
			out.push('growth.pipe needs an exponent and a tip radius above 0');
		const leader = growth.pipe.leader;
		if (leader !== undefined && !(leader >= 0.5 && leader <= 1))
			out.push(
				`growth.pipe.leader is ${leader}; a stem keeps a share of its girth from 0.5 to 1 from node to node`,
			);
	}
	if (growth.model === 'rosette') {
		if (record.foliage.kind !== 'thick') out.push("a rosette's foliage is 'thick'");
		spreadProblems(growth.shoots, 'growth.shoots', true, out);
		spreadProblems(growth.leaves, 'growth.leaves', true, out);
		for (const key of ['tilt', 'arch', 'stalk', 'size', 'pitch'] as const)
			curveProblems(growth[key], `growth.${key}`, out);
		shareProblem(growth.rolled, 'growth.rolled', out);
		if (growth.crown < 0) out.push(`growth.crown is ${growth.crown}; a radius is not negative`);
		if (growth.scapes) {
			spreadProblems(growth.scapes.height, 'growth.scapes.height', true, out);
			spreadProblems(growth.scapes.flowers, 'growth.scapes.flowers', true, out);
			shareProblem(growth.scapes.raceme, 'growth.scapes.raceme', out);
		}
	}
	if (growth.model === 'tuft') {
		if (record.foliage.kind !== 'grass-blade') out.push("a tuft's foliage is 'grass-blade'");
		spreadProblems(growth.shoots, 'growth.shoots', true, out);
		spreadProblems(growth.blades, 'growth.blades', true, out);
		spreadProblems(growth.sheath, 'growth.sheath', true, out);
		wholeProblem(growth.ranks, 'growth.ranks', 1, 3, out);
		for (const key of ['lean', 'spread', 'size'] as const)
			curveProblems(growth[key], `growth.${key}`, out);
		const heads = growth.heads;
		if (heads) {
			spreadProblems(heads.height, 'growth.heads.height', true, out);
			wholeProblem(heads.sides, 'growth.heads.sides', 3, 12, out);
			shareProblem(heads.stalkShare, 'growth.heads.stalkShare', out);
			if (heads.kind === 'panicle' && !heads.panicle)
				out.push("growth.heads is a 'panicle' and needs its panicle");
			if (heads.kind === 'spike' && !heads.spikes)
				out.push("growth.heads is a 'spike' head and needs its spikes");
			if (heads.panicle) curveProblems(heads.panicle.angle, 'growth.heads.panicle.angle', out);
		}
		const soil = growth.soil;
		if (soil) {
			spreadProblems(soil.roots, 'growth.soil.roots', true, out);
			spreadProblems(soil.rootLength, 'growth.soil.rootLength', true, out);
			spreadProblems(soil.droop, 'growth.soil.droop', true, out);
			if (!(soil.rootRadius > 0))
				out.push(`growth.soil.rootRadius is ${soil.rootRadius}; it must be above 0`);
			if (soil.rhizome !== undefined) {
				spreadProblems(soil.rhizome, 'growth.soil.rhizome', true, out);
				const radius = soil.rhizomeRadius;
				if (!(radius !== undefined && radius > 0))
					out.push('a rhizome needs its rhizomeRadius, in metres above 0');
				else if (radius > growth.base)
					out.push(
						`growth.soil.rhizomeRadius is ${radius}, thicker than the crown's base ${growth.base}: a rhizome is no wider than the crown it holds`,
					);
			}
		}
	}
	if (record.foliage.kind === 'blade' && record.foliage.compound) {
		const compound = record.foliage.compound;
		spreadProblems(compound.leaflets, 'foliage.compound.leaflets', true, out);
		if (!(compound.rachis > 0))
			out.push(`foliage.compound.rachis is ${compound.rachis}; it must be above 0`);
		const step = compound.leafletStep;
		if (step !== undefined) wholeProblem(step, 'foliage.compound.leafletStep', 0, 2, out);
		shareProblem(compound.leafletStalk, 'foliage.compound.leafletStalk', out);
		if (compound.angle !== undefined)
			wholeProblem(compound.angle, 'foliage.compound.angle', 30, 90, out);
	}
	if (record.foliage.kind === 'grass-blade') {
		const blade = record.foliage.blade;
		curveProblems(blade.profile, 'foliage.blade.profile', out);
		shareProblem(blade.tipLength, 'foliage.blade.tipLength', out);
		shareProblem(blade.dryTip, 'foliage.blade.dryTip', out);
		if (blade.width <= 0) out.push(`foliage.blade.width is ${blade.width}; it must be above 0`);
	}
	if (record.foliage.kind === 'thick') {
		const ribs = record.foliage.leaf.ribs;
		wholeProblem(ribs.count, 'foliage.leaf.ribs.count', 1, 24, out);
		shareProblem(ribs.start, 'foliage.leaf.ribs.start', out);
		if (ribs.depth < 0 || ribs.sweep <= 0)
			out.push('foliage.leaf.ribs needs a depth from 0 and a sweep above 0');
	}
	if (growth.model === 'architectural') {
		if (growth.orders.length === 0)
			out.push('growth.orders is empty; give the bough order at least');
		curveProblems(growth.tiers.spacing, 'growth.tiers.spacing', out);
		shareProblem(growth.tiers.start, 'growth.tiers.start', out);
		growth.orders.forEach((order, i) => {
			curveProblems(order.length, `growth.orders[${i}].length`, out);
			curveProblems(order.angle, `growth.orders[${i}].angle`, out);
			curveProblems(order.density, `growth.orders[${i}].density`, out);
			shareProblem(order.flatten, `growth.orders[${i}].flatten`, out);
		});
	}
}

/** An extra's band colour and roughness, which lie from 0 to 1, and its stalks' faces. */
function extraProblems(record: Species, out: string[]): void {
	record.extras?.forEach((extra, i) => {
		const path = `extras[${i}]`;
		const stalked = 'lathe' in extra.shape || 'samara' in extra.shape;
		if (stalked && extra.shape.stalkSides !== undefined)
			wholeProblem(extra.shape.stalkSides, `${path}.shape.stalkSides`, 4, 16, out);
		if ('samara' in extra.shape) {
			const samara = extra.shape.samara;
			if (!(samara.length > 0))
				out.push(
					`${path}.shape.samara.length is ${samara.length}; it is metres and must be above 0`,
				);
			if (!(samara.width > 0))
				out.push(`${path}.shape.samara.width is ${samara.width}; it is metres and must be above 0`);
			if (!(samara.body >= 0.1 && samara.body <= 0.6))
				out.push(
					`${path}.shape.samara.body is ${samara.body}; it is the seed body's share of the key's length, from 0.1 to 0.6`,
				);
			if (samara.twist !== undefined && !(samara.twist >= 0 && samara.twist <= 180))
				out.push(`${path}.shape.samara.twist is ${samara.twist}; it is degrees from 0 to 180`);
		}
		const crevice = 'lathe' in extra.shape ? extra.shape.scaleShade : undefined;
		if (crevice !== undefined && !(crevice >= 0 && crevice <= 1))
			out.push(`${path}.shape.scaleShade is ${crevice}; a share lies from 0 to 1`);
		const jitter = 'lathe' in extra.shape ? extra.shape.scaleJitter : undefined;
		if (jitter !== undefined && !(jitter >= 0 && jitter <= 1))
			out.push(`${path}.shape.scaleJitter is ${jitter}; a share lies from 0 to 1`);
		extra.offset?.forEach((value, k) => {
			if (!(value >= -0.5 && value <= 0.5))
				out.push(`${path}.offset[${k}] is ${value}; it is metres from -0.5 to 0.5`);
		});
		if (extra.group !== undefined) wholeProblem(extra.group, `${path}.group`, 0, 15, out);
		const bristles = 'lathe' in extra.shape ? extra.shape.bristles : undefined;
		if (bristles !== undefined) {
			if (!(bristles.rows >= 1 && bristles.rows <= 16))
				out.push(
					`${path}.shape.bristles.rows is ${bristles.rows}; it is a whole number from 1 to 16`,
				);
			if (!(bristles.sides >= 3 && bristles.sides <= 32))
				out.push(
					`${path}.shape.bristles.sides is ${bristles.sides}; it is a whole number from 3 to 32`,
				);
			if (!(bristles.length >= 0.001 && bristles.length <= 0.03))
				out.push(
					`${path}.shape.bristles.length is ${bristles.length}; it is metres from 0.001 to 0.03`,
				);
		}
		extra.bandColour?.forEach((channel, k) => {
			shareProblem(channel, `${path}.bandColour[${k}]`, out);
		});
		extra.roughness?.forEach((value, k) => {
			shareProblem(value, `${path}.roughness[${k}]`, out);
		});
		extra.stalkColour?.forEach((channel, k) => {
			shareProblem(channel, `${path}.stalkColour[${k}]`, out);
		});
		if (
			extra.bandColour &&
			!('lathe' in extra.shape && extra.shape.scaled) &&
			!('samara' in extra.shape)
		)
			out.push(
				`${path}.bandColour needs a lathe whose 'scaled' names the band it colours, or a samara whose seed body carries it`,
			);
	});
}

/**
 * Cutting hints that name a shoot class the record does not grow, cut a length of no wood, or press
 * foliage that cannot lie flat.
 */
function cuttingProblems(record: Species, out: string[]): void {
	// A blade, a thick leaf, a whole frond or a grass blade can lie pressed flat in its frame's plane.
	const leaf = record.cuttings?.leaf;
	if (record.cuttings?.leaves) spreadProblems(record.cuttings.leaves, 'cuttings.leaves', true, out);
	if (
		leaf?.pressed &&
		record.foliage.kind !== 'blade' &&
		record.foliage.kind !== 'thick' &&
		record.foliage.kind !== 'frond' &&
		record.foliage.kind !== 'grass-blade'
	)
		out.push(`cuttings.leaf.pressed lays a leaf flat, and the foliage is '${record.foliage.kind}'`);
	if (leaf?.petiole !== undefined && !(leaf.petiole > 0))
		out.push(`cuttings.leaf.petiole is ${leaf.petiole}; it is metres and must be above 0`);
	const density = record.cuttings?.density;
	if (density !== undefined && !(density >= 0.25 && density <= 8))
		out.push(`cuttings.density is ${density}; it is a share from 0.25 to 8`);
	const names = new Set([
		...(record.shoots?.classes ?? []).map((shoot) => shoot.name),
		...(record.shoots?.cuttingClasses ?? []).map((shoot) => shoot.name),
	]);
	for (const part of ['branch', 'subbranch', 'cluster'] as const) {
		const hint = record.cuttings?.[part];
		if (!hint) continue;
		if ('shoot' in hint) {
			if (!names.has(hint.shoot))
				out.push(`cuttings.${part}.shoot '${hint.shoot}' names no class in shoots.classes`);
		} else {
			if (hint.length <= 0)
				out.push(`cuttings.${part}.length is ${hint.length}; it must be above 0`);
			if (hint.scale !== undefined && !(hint.scale > 0))
				out.push(`cuttings.${part}.scale is ${hint.scale}; it is a multiple and must be above 0`);
		}
	}
}

/**
 * The problems of each of a record's other forms: a name that is not a kebab-case word, a field that
 * a form may not change, a change of the growth model or of the kind of foliage, and every problem of
 * the record that the form grows from.
 */
function formProblems(record: Species, out: string[]): void {
	for (const [name, form] of Object.entries(record.forms ?? {})) {
		const path = `forms.${name}`;
		if (!KEBAB.test(name))
			out.push(`${path}: a form's name is a kebab-case word, such as young or woodland`);
		for (const key of Object.keys(form))
			if (!Object.hasOwn(FORM_FIELDS, key))
				out.push(`${path}.${key} is not a field a form changes; a form keeps the species' own`);
		const grown = formRecord(record, name);
		if (grown.growth?.model !== record.growth.model)
			out.push(
				`${path}.growth.model is '${grown.growth?.model}'; a form grows by its species' model, '${record.growth.model}'`,
			);
		if (grown.foliage?.kind !== record.foliage.kind)
			out.push(
				`${path}.foliage.kind is '${grown.foliage?.kind}'; a form keeps its species' kind of foliage, '${record.foliage.kind}'`,
			);
		try {
			for (const problem of speciesProblems(grown)) out.push(`${path}: ${problem}`);
		} catch (error) {
			// A form given as plain data can drop a field that every record needs, which the type of a
			// form refuses; the check names the form rather than failing on the record it makes.
			out.push(
				`${path} makes a record that cannot be checked (${(error as Error).message}); a form drops only the fields a record may leave out`,
			);
		}
	}
}

/**
 * Every problem with a species record, one line each, with what to change. Each of the record's
 * other forms is checked as the record it grows from, and its problems name the form.
 *
 * @param record The species record.
 * @returns The problems, empty when the record and each of its forms can grow.
 * @category api/vegetation
 */
export function speciesProblems(record: Species): string[] {
	const out: string[] = [];
	nonFinite(record, 'record', out);
	if (!KEBAB.test(record.id))
		out.push(`id '${record.id}' must be kebab-case, as its folder under species/ is named`);
	for (const key of ['name', 'latin', 'form'] as const)
		if (!record[key] || record[key].trim() === '') out.push(`${key} is empty`);
	spreadProblems(record.size.height, 'size.height', true, out);
	if (record.size.aspect <= 0) out.push(`size.aspect is ${record.size.aspect}; it must be above 0`);
	if (record.size.dbh !== undefined && record.size.dbh <= 0)
		out.push(`size.dbh is ${record.size.dbh}; it must be above 0`);
	wholeProblem(record.variants, 'variants', 1, 8, out);
	wholeProblem(record.seedSalt, 'seedSalt', 0, 0xffffffff, out);
	growthProblems(record, out);
	if (record.envelope) envelopeProblems(record.envelope, out);
	if (record.base) baseProblems(record.base, out);
	if (record.shoots) shootProblems(record.shoots, out);
	cuttingProblems(record, out);
	sparseProblems(record, out);
	extraProblems(record, out);
	if (record.lod.nearFoliage === 'instanced' && !record.shoots)
		out.push("lod.nearFoliage is 'instanced', which needs shoots; give shoots or use 'merged'");
	if (typeof record.textures !== 'string') {
		if (!KEBAB.test(record.textures.from))
			out.push(`textures.from '${record.textures.from}' must name a species folder`);
		if (record.textures.from === record.id)
			out.push("textures.from names the species itself; use 'own'");
	}
	if (!SEASONS.includes(record.seasons.default))
		out.push(`seasons.default is '${record.seasons.default}'; use one of ${SEASONS.join(', ')}`);
	record.bark?.zones.forEach((zone, i) => {
		if (zone.from >= zone.to) out.push(`bark.zones[${i}] runs from ${zone.from} to ${zone.to}`);
		if (!Number.isInteger(zone.layer) || zone.layer < 0)
			out.push(`bark.zones[${i}].layer is ${zone.layer}; a layer is a whole number from 0`);
		zone.tint?.forEach((channel, c) => {
			notNegative(channel, `bark.zones[${i}].tint[${c}]`, out);
		});
		if (zone.second) {
			if (zone.second.from >= zone.second.to)
				out.push(`bark.zones[${i}].second runs from ${zone.second.from} to ${zone.second.to}`);
			if (!(zone.second.blend >= 0))
				out.push(`bark.zones[${i}].second.blend is ${zone.second.blend}; it is metres from 0`);
		}
	});
	for (const [season, tint] of Object.entries(record.seasons.bark ?? {}))
		tint.forEach((channel, c) => {
			notNegative(channel, `seasons.bark.${season}[${c}]`, out);
		});
	for (const [season, leaves] of Object.entries(record.seasons.leaves ?? {})) {
		// Only a winter stand draws colours of its own: every other season of a turning plant takes
		// the autumn colours, and the autumn block holds those.
		if (season !== 'winter')
			out.push(
				`seasons.leaves names ${season}; set winter, the one season the shader draws its own leaf colours for, or leave the season out`,
			);
		leaves.reflectance.forEach((channel, c) => {
			notNegative(channel, `seasons.leaves.${season}.reflectance[${c}]`, out);
		});
		leaves.transmittance.forEach((channel, c) => {
			notNegative(channel, `seasons.leaves.${season}.transmittance[${c}]`, out);
		});
	}
	if (record.bark) curveProblems(record.bark.girthScale, 'bark.girthScale', out);
	const fork = record.bark?.fork;
	if (fork?.bend !== undefined && !(fork.bend > 0))
		out.push(`bark.fork.bend is ${fork.bend}; it must be above 0`);
	if (fork?.knot !== undefined && !(fork.knot >= 0 && fork.knot <= 1))
		out.push(`bark.fork.knot is ${fork.knot}; it is a share from 0 to 1`);
	curveProblems(record.wind.stiffness, 'wind.stiffness', out);
	const flutter = record.wind.flutter.byHeight;
	if (flutter !== undefined) {
		curveProblems(flutter, 'wind.flutter.byHeight', out);
		if (typeof flutter !== 'number')
			for (let i = 0; i < flutter.length; i++) {
				const value = (flutter[i] as readonly [number, number])[1];
				if (!(value >= 0))
					out.push(`wind.flutter.byHeight's pair ${i} is ${value}; a share is not negative`);
			}
		else if (!(flutter >= 0))
			out.push(`wind.flutter.byHeight is ${flutter}; a share is not negative`);
	}
	const power = record.wind.sway?.power;
	if (power !== undefined && !(power >= 1 && power <= 6))
		out.push(`wind.sway.power is ${power}; it is a number from 1 to 6`);
	const lod = record.lod;
	lod.switchPixels.forEach((pixels, i) => {
		if (pixels <= 0) out.push(`lod.switchPixels[${i}] is ${pixels}; it must be above 0`);
	});
	if (lod.woodOrders[1] > lod.woodOrders[0])
		out.push('lod.woodOrders keeps more orders at the second card level than at the first');
	if (lod.cardStalk !== undefined && !(lod.cardStalk >= 0 && lod.cardStalk <= 8))
		out.push(`lod.cardStalk is ${lod.cardStalk}; it is pixels from 0 to 8`);
	if (lod.impostor.views < 2 || lod.impostor.texels < 8)
		out.push('lod.impostor needs at least 2 views across and 8 texels a view');
	for (const [key, value] of Object.entries(lod.budget))
		if (value < 0) out.push(`lod.budget.${key} is ${value}; a budget is not negative`);
	shareProblem(record.roundBand, 'roundBand', out);
	out.push(...capProblems(record));
	formProblems(record, out);
	return out;
}

/**
 * Checks a species record and returns it, or throws one error that lists every problem.
 *
 * @param record The species record.
 * @returns The same record.
 * @category api/vegetation
 */
export function checkSpecies(record: Species): Species {
	const problems = speciesProblems(record);
	if (problems.length > 0)
		throw new Error(
			`@null3d/vegetation: the species '${record.id}' cannot grow.\n${problems.join('\n')}`,
		);
	return record;
}
