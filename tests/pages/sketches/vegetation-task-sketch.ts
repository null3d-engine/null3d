// Grows every built-in species through the add-on's job-worker task, on the GPU path that the page
// forces. Each task-grown plant is compared with the plant that the same species and seed grow on
// this thread, so a task that lost a buffer or gave another plant shows. The sketch posts one
// message when every species has answered, or one that names the error.
import { defineSketch } from '@null3d/engine';
import {
	ALL_SPECIES,
	generatePlant,
	generatePlantInTask,
	type PlantAsset,
} from '@null3d/vegetation';

/** The seed that every species grows for, on the thread and in the task. */
const SEED = 12;

/** Whether two byte views hold the same bytes. */
function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** Whether the task-grown plant is the one that the thread grows from the same species and seed. */
function samePlant(left: PlantAsset, right: PlantAsset): boolean {
	if (left.levels.length !== right.levels.length) return false;
	for (let l = 0; l < left.levels.length; l++) {
		const a = left.levels[l];
		const b = right.levels[l];
		if (!a || !b || a.parts.length !== b.parts.length) return false;
		for (let p = 0; p < a.parts.length; p++) {
			const one = a.parts[p]?.arrays;
			const other = b.parts[p]?.arrays;
			if (!one || !other) return false;
			if (!sameBytes(one.positions, other.positions)) return false;
			if (!sameBytes(one.indices, other.indices)) return false;
		}
	}
	return sameBytes(left.wind.pivots, right.wind.pivots);
}

export default defineSketch(({ page }) => {
	let started = false;
	return {
		onUpdate() {
			if (started) return;
			started = true;
			void (async () => {
				const species: {
					id: string;
					triangles: number;
					parts: number;
					matches: boolean;
				}[] = [];
				for (const record of ALL_SPECIES) {
					const direct = generatePlant(record, { seed: SEED });
					const grown = await generatePlantInTask(record, { seed: SEED });
					species.push({
						id: record.id,
						triangles: grown.stats.triangles,
						parts: grown.levels[0]?.parts.length ?? 0,
						matches: samePlant(direct, grown),
					});
				}
				page.post('grown', { species });
			})().catch((error: unknown) => page.post('failed', { message: String(error) }));
		},
	};
});
