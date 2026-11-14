// The switches that a sketch reads from its own address. A test page names the sketch with
// ?sketch=, and the sketch's module keeps its own query after it, so one sketch can draw two ways
// for two tests. The page's URL switches do not reach the sketch, which runs in a worker.

import type { Quality } from '@null3d/engine';

/**
 * Applies the quality settings that `url`, a sketch's own address, asks for. `?bounce=off` leaves
 * out the preset's screen-space bounce light, whose steps read ambient occlusion's grid and the
 * frame's color copy: a page that draws it downloads both features' shader files, so a test that
 * must see one feature's file alone turns it off.
 */
export function applySketchSwitches(url: string, quality: Quality): void {
	if (new URL(url).searchParams.get('bounce') === 'off') quality.set({ bounceRays: 0 });
}
