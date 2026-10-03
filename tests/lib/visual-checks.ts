// The visual checks' results and limits, shared by the browser tests, the benchmark tests and the
// device runner.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	AcneFigures,
	ContactFigures,
	StabilityFigures,
	StairSteps,
} from '../pages/lib/shadow-check.ts';

/** What the visual page publishes. */
export interface VisualResult {
	error?: string;
	tier: string;
	scene: string;
	width: number;
	height: number;
	stability: StabilityFigures;
	edges: { offsetPixels: number; steps?: StairSteps; referenceSteps?: StairSteps };
	/** The contact figures, which runner pages from before the contact check leave out. */
	contact?: ContactFigures;
	/** The acne figures, which runner pages from before the acne check leave out. */
	acne?: AcneFigures;
	/** PNG files in base64, by name. */
	images?: Record<string, string>;
}

/** The most that each figure of a scene may reach before it counts as a regression. */
export interface VisualLimits {
	/** The share of pixels, in percent, whose shadow may change between two frames. */
	changedPercent: number;
	/** How far shadow edges may stray from the reference's, in pixels. */
	edgeOffsetPixels: number;
	/** The stair steps of the scene's long edge, in pixels, where it has one. */
	stairStepPixels?: number;
	/** The mean light between a caster's foot and its shadow, in pixels, where the scene has feet. */
	contactGapPixels?: number;
	/** The mean shadow on flat surfaces that the reference lights, in percent. */
	acnePercent?: number;
}

/**
 * The limits of each scene that the checks measure, on both GPU paths, with Chrome on the Mac's GPU
 * and with SwiftShader in CI. Each sits between the figures of the engine as it is and the figures
 * of two faults put back on purpose, which .dev/image-tests.md lists with the figures. Cascades
 * that no longer snap to whole texels fail the share of changed pixels in every scene. The edge
 * figures depend on each scene's edges, so each scene has its own: the split that leaned further
 * toward the logarithmic spread fails the shadow scene's stair steps and S4's edge offset. The
 * other edge limits catch only large faults, as that split leaves those figures alone or lowers
 * them. S4's contact limit fails its frame without the casters' offset in CI, and catches only
 * larger faults on the Mac's GPU.
 */
export const VISUAL_LIMITS: Readonly<Record<string, VisualLimits>> = {
	'shadow-scene': { changedPercent: 0.05, edgeOffsetPixels: 0.15, stairStepPixels: 0.19 },
	s2: { changedPercent: 0.05, edgeOffsetPixels: 0.15 },
	s4: { changedPercent: 0.05, edgeOffsetPixels: 0.114, contactGapPixels: 0.06, acnePercent: 0.3 },
};

/** The views of the contact scene that the contact checks draw. */
export type ContactCase =
	| 'near'
	| 'far'
	| 'turn'
	| 'far-ground'
	| 'far-slabs'
	| 'far-slabs-sun-35'
	| 'far-slabs-sun-20';

/** A view of the contact scene, and the most that each of its figures may reach. */
export interface ContactLimits {
	/** The contact scene's query: its view and switches. */
	query: string;
	/** The mean light between a box's foot and its shadow, in pixels. */
	gapPixels?: number;
	/** The mean shadow on a box's lit top past its edge, in pixels. */
	rimPixels?: number;
	/** The share of the frame's pixels in shadow, in percent. */
	shadowedPercent?: number;
	/** The mean shadow on flat surfaces that the reference lights, in percent. */
	acnePercent?: number;
}

/**
 * The contact checks' views and limits, on both GPU paths, with Chrome on the Mac's GPU and with
 * SwiftShader in CI. .dev/decisions/D-16-moving-casters-and-bias.md gives the figures. Each gap's
 * limit sits between the figures with the casters' offset and without it, which fails each of
 * them. The rims' limits and the casting ground's share in shadow sit between the figures with the
 * offset and with a full texel for every back face, uncapped, which shadows the boxes' own tops and
 * the casting ground's top.
 */
export const CONTACT_LIMITS: Readonly<Record<ContactCase, ContactLimits>> = {
	near: { query: 'view=near', gapPixels: 0.06, rimPixels: 0.16 },
	far: { query: 'view=far', gapPixels: 0.13, rimPixels: 0.4 },
	turn: { query: 'view=turn', gapPixels: 0.11, rimPixels: 0.3 },
	'far-ground': { query: 'view=far&groundCasts', shadowedPercent: 9.6 },
	'far-slabs': { query: 'view=far&slabs&filter=5', acnePercent: 6 },
	'far-slabs-sun-35': { query: 'view=far&slabs&filter=5&sun=35', acnePercent: 10 },
	'far-slabs-sun-20': { query: 'view=far&slabs&filter=5&sun=20', acnePercent: 11 },
};

/** A figure over its limit, as a problem, or nothing. */
function overLimit(what: string, value: number, limit: number | undefined, unit: string): string[] {
	return limit !== undefined && value > limit
		? [`${what} measures ${value.toFixed(3)} ${unit}, over the limit of ${limit} ${unit}`]
		: [];
}

/** What is wrong with a visual page's figures for a view of the contact scene; empty when nothing is. */
export function contactProblems(name: ContactCase, result: VisualResult): string[] {
	const limits = CONTACT_LIMITS[name];
	const { contact, stability, acne } = result;
	if (!contact) return ['the visual page measured no contact figures'];
	return [
		...(limits.gapPixels !== undefined && contact.feet < 20
			? [`only ${contact.feet} feet of boxes were found in the frame`]
			: []),
		...overLimit("the light at the boxes' feet", contact.meanGapPixels, limits.gapPixels, 'px'),
		...overLimit("the shadow on the boxes' tops", contact.meanRimPixels, limits.rimPixels, 'px'),
		...overLimit('the share in shadow', stability.shadowedPercent, limits.shadowedPercent, '%'),
		...acneProblems(acne, limits.acnePercent),
	];
}

/** The acne figure over its limit, as a problem, or nothing. */
function acneProblems(acne: AcneFigures | undefined, limit: number | undefined): string[] {
	if (limit === undefined) return [];
	if (!acne || acne.pixels < 1000) return ['the visual page found too little open lit ground'];
	return overLimit('the shadow on open lit ground', acne.meanShadowPercent, limit, '%');
}

/**
 * Writes a visual page's figures into `folder` as `figures.json`, and each PNG file it captured as
 * `<name>.png`, so people can look at the frames that the figures come from.
 */
export function saveVisualResult(folder: string, result: VisualResult): void {
	mkdirSync(folder, { recursive: true });
	for (const [name, png] of Object.entries(result.images ?? {}))
		writeFileSync(join(folder, `${name}.png`), Buffer.from(png, 'base64'));
	const { stability, edges, contact, acne } = result;
	writeFileSync(
		join(folder, 'figures.json'),
		JSON.stringify({ stability, edges, contact, acne }, null, '\t'),
	);
}

/** What is wrong with a visual page's figures for `scene`; empty when nothing is. */
export function visualProblems(scene: string, result: VisualResult): string[] {
	const limits = VISUAL_LIMITS[scene];
	if (!limits) return [];
	const { stability, edges } = result;
	const problems: string[] = [];
	if (stability.shadowedPercent < 1) problems.push('the frame shows almost no shadow');
	if (stability.changedPercent > limits.changedPercent)
		problems.push(
			`${stability.changedPercent.toFixed(3)}% of the pixels changed their shadow between frames, over the limit of ${limits.changedPercent}%`,
		);
	if (edges.offsetPixels > limits.edgeOffsetPixels)
		problems.push(
			`shadow edges stray ${edges.offsetPixels.toFixed(3)} px from the reference's, over the limit of ${limits.edgeOffsetPixels} px`,
		);
	if (result.contact)
		problems.push(
			...overLimit(
				"the light between casters' feet and their shadows",
				result.contact.meanGapPixels,
				limits.contactGapPixels,
				'px',
			),
		);
	if (result.acne) problems.push(...acneProblems(result.acne, limits.acnePercent));
	const steps = edges.steps?.rmsPixels;
	if (limits.stairStepPixels !== undefined && steps !== undefined && steps > limits.stairStepPixels)
		problems.push(
			`the long edge's stair steps measure ${steps.toFixed(3)} px, over the limit of ${limits.stairStepPixels} px`,
		);
	return problems;
}
