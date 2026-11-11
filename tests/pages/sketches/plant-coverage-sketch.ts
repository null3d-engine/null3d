// The coverage row: one oak crown grown through the plant core and placed three times at three
// distances: two copies in the first band of the core's card levels and one in the second.
// The sketch posts where the crowns lie on the picture once the first frame has drawn, since only
// then does the camera place points where that frame draws them.
import { defineSketch } from '@null3d/engine';
import { addCoverageRow, projectCrown } from '../lib/plant-coverage';

/** The page's proving controls, which a run may put on the sketch's address. */
const QUERY = new URL(import.meta.url).searchParams;

/** A number on the query, if it holds one. */
function numberOn(name: string): number | undefined {
	const text = QUERY.get(name);
	if (text === null) return undefined;
	const value = Number(text);
	return Number.isFinite(value) ? value : undefined;
}

export default defineSketch(async (ctx) => {
	// The coverage reading must come from a frame drawn at the canvas's own size. The frame-budget
	// governor could lower the render scale on a busy machine, and a picture drawn below the whole
	// canvas would cover a different share of each box.
	ctx.quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	const row = await addCoverageRow(ctx, {
		sparse: numberOn('sparse'),
		cardCutoff: numberOn('cardCutoff'),
	});
	let posted = false;
	return {
		onLateUpdate() {
			if (posted) return;
			posted = true;
			const boxes = row.crowns.map((crown) => projectCrown(row.camera, crown));
			ctx.page.post('plant-coverage', {
				distances: row.distances,
				levels: row.levels,
				boxes,
			});
		},
	};
});
