// The comparisons with three.js as a page lists them: each one's folder name and title, with no
// scene. The examples page lists the comparisons from this module, and imports comparisons.ts,
// which holds every comparison's scene description, only when its address runs a comparison. So a
// demo's page downloads no comparison's scene. Each entry of comparisons.ts takes its name and
// title from here.

import type { DemoGroup } from '../demos';

/** The group that a page lists the comparisons under. */
export const COMPARE_GROUP: DemoGroup = 'Compare with three.js';

/** A comparison as a page lists it. */
export interface ComparisonListing {
	/** The comparison's folder under compare/: lowercase words joined by dashes. */
	readonly name: string;
	readonly title: string;
}

/** The comparisons, in the order that a page lists them. */
export const COMPARISON_LISTINGS: readonly ComparisonListing[] = [
	{ name: 'battle', title: 'Battle' },
	{ name: 'factory', title: 'Factory' },
	{ name: 'night-town', title: 'Night effects' },
];
