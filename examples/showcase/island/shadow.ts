// The Island's shadow reach, apart from the sketch that draws it: how far the sun's shadows reach
// on each quality preset, which the shipped change holds short and fixed on a phone.
import type { QualityPreset } from '@null3d/engine';
import type { ShadowReach } from '../../lib/shadow-range';
import { TOWN } from './island';

/**
 * The town's core, which keeps its shadows wherever the camera stands. The sun's shadows reach this
 * far close up, and further as the camera draws back.
 */
export const SHADOW_REACH: ShadowReach = {
	// Far enough for the route's low flights, so its shadows hold still there: each step of the range moves every
	// cascade, and every shadow in view jumps at once.
	distance: 600,
	center: [TOWN.x, TOWN.height + 20, TOWN.z],
	radius: TOWN.radius * 1.2,
};

/**
 * How far the sun's shadows reach on each preset, in meters. A phone draws at Low, where the shadow
 * maps are the scene's largest cost, so its range stays short and fixed. The far hills then lose
 * their shadows, and the town keeps them from the views a phone shows. The other presets take the
 * scene's stretchable range, which grows as the camera draws back.
 */
export const SHADOW_DISTANCE: Record<QualityPreset, number> = {
	low: 250,
	medium: SHADOW_REACH.distance,
	high: SHADOW_REACH.distance,
	ultra: SHADOW_REACH.distance,
};
