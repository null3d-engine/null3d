// The record check: every problem with a species record, found at once, so a worker fixes them in
// one pass. It checks what any record must hold (names, numbers in their ranges, curves that rise,
// the envelope a self-organizing plant needs, shoot classes whose shares add up, the detail levels
// and the budget under the owner's caps). Each grower may hold its model's finer rules beside it.
import { capProblems } from './caps';
import type { Envelope, GrowthModel, ShootSpec, Species } from './record';
import type { Curve, Spread } from './types';

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

function shootProblems(shoots: ShootSpec, out: string[]): void {
	wholeProblem(shoots.prototypes, 'shoots.prototypes', 4, 12, out);
	wholeProblem(shoots.orders, 'shoots.orders', 1, 3, out);
	if (shoots.leafYears > shoots.years)
		out.push(`shoots.leafYears is ${shoots.leafYears}, more than shoots.years (${shoots.years})`);
	if (shoots.classes.length === 0) out.push('shoots.classes is empty; give at least one class');
	let share = 0;
	shoots.classes.forEach((shoot, i) => {
		const path = `shoots.classes[${i}]`;
		share += shoot.share;
		const [low, high] = shoot.vigor;
		if (low < 0 || high > 1 || low > high)
			out.push(`${path}.vigor is [${low}, ${high}]; give a rising range within 0 to 1`);
		spreadProblems(shoot.length, `${path}.length`, true, out);
		spreadProblems(shoot.nodes, `${path}.nodes`, true, out);
		curveProblems(shoot.internode, `${path}.internode`, out);
		curveProblems(shoot.leafScale, `${path}.leafScale`, out);
		curveProblems(shoot.leafAngle, `${path}.leafAngle`, out);
		if (shoot.years !== undefined) wholeProblem(shoot.years, `${path}.years`, 1, 3, out);
	});
	if (shoots.classes.length > 0 && Math.abs(share - 1) > 0.01)
		out.push(`shoots.classes' shares add up to ${share}; they must add up to 1`);
	curveProblems(shoots.placement.perMetre, 'shoots.placement.perMetre', out);
	shareProblem(shoots.placement.shadePrune, 'shoots.placement.shadePrune', out);
	shareProblem(shoots.placement.skyward, 'shoots.placement.skyward', out);
	spreadProblems(shoots.placement.scale, 'shoots.placement.scale', true, out);
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
		wholeProblem(growth.light.cells, 'growth.light.cells', 8, 96, out);
		if (growth.internode.length <= 0)
			out.push(`growth.internode.length is ${growth.internode.length}; it must be above 0`);
		shareProblem(growth.internode.ageFactor, 'growth.internode.ageFactor', out);
		shareProblem(growth.buds.extinction[0], 'growth.buds.extinction[0]', out);
		shareProblem(growth.buds.extinction[1], 'growth.buds.extinction[1]', out);
		curveProblems(growth.buds.angle, 'growth.buds.angle', out);
		curveProblems(growth.apical.control, 'growth.apical.control', out);
		curveProblems(growth.tropism.photo, 'growth.tropism.photo', out);
		curveProblems(growth.tropism.gravi, 'growth.tropism.gravi', out);
		shareProblem(growth.shedding.cleanBole, 'growth.shedding.cleanBole', out);
		shareProblem(growth.shedding.stubs, 'growth.shedding.stubs', out);
		spreadProblems(growth.stems.count, 'growth.stems.count', true, out);
		if (growth.pipe.exponent <= 0 || growth.pipe.tipRadius <= 0)
			out.push('growth.pipe needs an exponent and a tip radius above 0');
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

/**
 * Every problem with a species record, one line each, with what to change.
 *
 * @param record The species record.
 * @returns The problems, empty when the record can grow.
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
	if (record.shoots) shootProblems(record.shoots, out);
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
	});
	if (record.bark) curveProblems(record.bark.girthScale, 'bark.girthScale', out);
	curveProblems(record.wind.stiffness, 'wind.stiffness', out);
	const lod = record.lod;
	lod.switchPixels.forEach((pixels, i) => {
		if (pixels <= 0) out.push(`lod.switchPixels[${i}] is ${pixels}; it must be above 0`);
	});
	if (lod.woodOrders[1] > lod.woodOrders[0])
		out.push('lod.woodOrders keeps more orders at the second card level than at the first');
	if (lod.impostor.views < 2 || lod.impostor.texels < 8)
		out.push('lod.impostor needs at least 2 views across and 8 texels a view');
	for (const [key, value] of Object.entries(lod.budget))
		if (value < 0) out.push(`lod.budget.${key} is ${value}; a budget is not negative`);
	shareProblem(record.roundBand, 'roundBand', out);
	out.push(...capProblems(record));
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
