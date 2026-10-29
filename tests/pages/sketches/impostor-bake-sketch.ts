// Bakes a plant's far-tree impostor at each preset's atlas grid, and reports what each bake cost:
// the time on the device's sketch thread and the bytes that its two atlases hold. The bake runs on
// the CPU, so the figures hold on every GPU path. The page sends a message that starts the bakes,
// so the engine's start is timed apart from them.
import { defineSketch } from '@null3d/engine';
import {
	bakeFarTree,
	bakePlantAtlases,
	builtInSpecies,
	generatePlant,
	type Species,
} from '@null3d/vegetation';

/** The species that each bake draws: a broad conifer crown, a light birch and a heavy oak. */
const SPECIES_IDS = ['conifer', 'birch', 'oak'];

/** The views that each preset bakes, which `octahedralAtlas` turns into a grid. */
const VIEWS: Readonly<Record<string, number>> = { low: 25, medium: 49, high: 81, ultra: 144 };

/** The texels on each side of a cell. */
const TEXELS = 64;

export default defineSketch((ctx) => {
	const { scene, page } = ctx;
	scene.setBackground('#20262f');
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		position: [0, 9, 34],
		target: [0, 6.5, 0],
	});
	scene.setActiveCamera(camera);
	const atlases = bakePlantAtlases(ctx);
	const plants = SPECIES_IDS.map((id) => {
		const species = builtInSpecies(id);
		if (!species) throw new Error(`the ${id} species is missing`);
		return { species: species as Species, asset: generatePlant(species, { seed: 7, levels: 1 }) };
	});
	page.onMessage((message) => {
		if (message !== 'bake') return;
		const runs: {
			preset: string;
			species: string;
			views: number;
			columns: number;
			rows: number;
			ms: number;
			bytes: number;
			triangles: number;
		}[] = [];
		for (const [preset, views] of Object.entries(VIEWS)) {
			for (const { species, asset } of plants) {
				const level = asset.levels[asset.impostorSource.level];
				let triangles = 0;
				for (const part of level?.parts ?? []) triangles += part.arrays.indices.length / 3;
				const started = performance.now();
				const far = bakeFarTree(ctx, { asset, atlases, views, texels: TEXELS });
				const ms = performance.now() - started;
				runs.push({
					preset,
					species: species.id,
					views,
					columns: far.atlas.columns,
					rows: far.atlas.rows,
					ms,
					// The two atlases, four bytes a texel.
					bytes: far.atlas.columns * TEXELS * far.atlas.rows * TEXELS * 4 * 2,
					triangles,
				});
			}
		}
		page.post('baked', runs);
	});
	return {};
});
