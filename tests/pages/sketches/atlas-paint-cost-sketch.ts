// The bark and leaf atlas painters for their cost page (tests/pages/atlas-paint-cost.ts). The page
// sends 'paint', and the sketch paints each atlas in turn for ?rounds= rounds, three by default,
// with the order swapped, and posts how long each took. The painters are the ones that
// bakePlantAtlases runs, with no texture upload and no drawing between them, so a round is the
// paint alone.
import { defineSketch } from '@null3d/engine';
import { paintBark, paintLeaf } from '@null3d/vegetation';

const rounds = Math.max(
	1,
	Math.floor(Number(new URL(import.meta.url).searchParams.get('rounds') ?? '3')),
);

/** How long one painter took, in milliseconds. */
function took(paint: () => unknown): number {
	const start = performance.now();
	paint();
	return performance.now() - start;
}

/** The middle figure of a round's times. */
function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export default defineSketch(({ scene, page }) => {
	scene.setBackground('#9fc0dd');
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 1, 4], target: [0, 1, 0] }));
	let painting = false;
	page.onMessage((message) => {
		if (message !== 'paint' || painting) return;
		painting = true;
		// The painters block the thread, so let this message return and a frame draw before they run.
		setTimeout(() => {
			const times: { bark: number; leaf: number }[] = [];
			for (let round = 0; round < rounds; round++) {
				// The order swaps each round, so a paint that pays for the one before it shows in both.
				let bark = 0;
				let leaf = 0;
				if (round % 2 === 0) {
					bark = took(paintBark);
					leaf = took(paintLeaf);
				} else {
					leaf = took(paintLeaf);
					bark = took(paintBark);
				}
				times.push({ bark, leaf });
			}
			page.post('painted', {
				times,
				barkMs: median(times.map((time) => time.bark)),
				leafMs: median(times.map((time) => time.leaf)),
			});
		}, 0);
	});
});
