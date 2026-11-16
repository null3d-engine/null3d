// The fixture add-on's entry: it declares the plugin interface that it was built for, as an add-on
// from another developer does, and its step makes objects as it runs. A page that calls the step in
// every frame allocates in every frame, which is what the add-on check's allocation gate reports.
import { checkPluginInterface, PLUGIN_INTERFACE_VERSION } from '@null3d/engine';

checkPluginInterface('d9-addon-allocating', {
	min: PLUGIN_INTERFACE_VERSION,
	max: PLUGIN_INTERFACE_VERSION,
});

/** How many objects each step makes beside the one for each step it is given. */
const PER_STEP = 16;

/**
 * The objects that the last step made, which a page may read. They outlive the step, so the browser
 * keeps them, and the step allocates them for real in every frame.
 */
export const trailPoints: { x: number; y: number }[] = [];

/**
 * Makes an object for each of `count` steps and a few more, and gives the first one's place. The
 * objects are the point: the add-on allocates by design, so a page that runs it every frame has a
 * figure for the gate to report.
 */
export function trail(count: number): number {
	trailPoints.length = 0;
	for (let step = 0; step < count; step++) trailPoints.push({ x: step * 0.5, y: step * 0.25 });
	for (let step = 0; step < PER_STEP; step++) trailPoints.push({ x: step, y: step + count });
	return trailPoints[0]?.x ?? 0;
}
