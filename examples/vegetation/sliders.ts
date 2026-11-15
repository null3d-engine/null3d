// The panel's wiring: a slider that moves regrows the meadow, but only once the hand settles, so a
// drag grows the meadow at its end rather than at every step. A season button grows it at once,
// since a change that waited to settle would only grow the same meadow a second time.
import { isPolygonStep, type MeadowControls, polygonMaximum } from './hud';

/**
 * Listens for the panel's messages and writes each change into the controls, calling `grow` once the
 * change lands and `showHud` so the panel shows what it now holds.
 */
export function wirePanel(
	page: { onMessage(handler: (name: string, value: unknown) => void): void },
	controls: MeadowControls,
	grow: () => void,
	showHud: () => void,
): void {
	let settling = 0;
	const settleThenGrow = (): void => {
		clearTimeout(settling);
		settling = setTimeout(grow, 350) as unknown as number;
	};
	page.onMessage((name, value) => {
		if (name === 'season') {
			if (value !== 'summer' && value !== 'autumn' && value !== 'winter' && value !== 'blossom')
				return;
			controls.season = value;
			showHud();
			clearTimeout(settling);
			grow();
			return;
		}
		const next = Number(value);
		if (!Number.isFinite(next)) return;
		// A value that the slider already holds changes nothing, so the meadow stays as it is.
		if (name === 'sparse') {
			if (next < 0 || next > 1 || next === controls.sparse) return;
			controls.sparse = next;
		} else if (name === 'polygons') {
			if (!isPolygonStep(next)) return;
			const maxTriangles = polygonMaximum(next);
			if (maxTriangles === controls.maxTriangles) return;
			controls.maxTriangles = maxTriangles;
		} else return;
		showHud();
		settleThenGrow();
	});
}
