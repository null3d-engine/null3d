// One showcase plant stood alone at the origin for the card check: its mesh, or the engine's
// octahedral card baked from it. ?kind=, ?mode=, ?dist= and ?scale=.
import { type Camera, defineSketch } from '@null3d/engine';
import { createImpostors } from '@null3d/impostors';
import { createWind } from '@null3d/wind';
import { partsOf, standPart, swayingPart } from '../../../examples/lib/blender-models';
import { createSway } from '../../../examples/lib/sway';
import { loadPlantCard, type PlantKind } from '../../../examples/showcase/island/models';

/** The crown's height above the foot, for the plants the check draws. */
const CROWN_HEIGHT: Record<string, number> = {
	cypress: 8.5,
	'stone-pine': 8,
	olive: 4,
	'holm-oak': 6,
};
/** How each plant sways, as the trees file gives it. */
const SWAY: Record<string, { sway: number; stiffness: number; rustle: number }> = {
	cypress: { sway: 0.014, stiffness: 2, rustle: 0.018 },
	'stone-pine': { sway: 0.025, stiffness: 2, rustle: 0.03 },
	olive: { sway: 0.02, stiffness: 2, rustle: 0.03 },
	'holm-oak': { sway: 0.016, stiffness: 2, rustle: 0.02 },
};

const params = new URL(import.meta.url).searchParams;
/** A query's number, or the fallback when it is missing or not a number. */
const number = (name: string, fallback: number): number => {
	const value = Number(params.get(name));
	return Number.isFinite(value) ? value : fallback;
};
const kind = (params.get('kind') ?? 'stone-pine') as PlantKind;
const mode = params.get('mode') === 'card' ? 'card' : 'mesh';
const distance = number('dist', 150);
const size = number('scale', 1);
/** The file that holds this plant: the oleander is in the shrubs file, the rest in the trees file. */
const glb = `/samples/sources/showcase/island/${kind === 'oleander' ? 'shrubs' : 'trees'}.glb`;

function poseFor(camera: Camera, crownY: number): void {
	camera.setPosition(
		Math.cos(0.785) * distance,
		crownY + Math.sin(0.524) * distance,
		Math.sin(0.785) * distance,
	);
	camera.lookAt(0, crownY, 0);
}

export default defineSketch(async (ctx) => {
	const { scene, quality, assets } = ctx;
	scene.setBackground('#8fa6b8');
	scene.createAmbientLight({ intensity: 1.6 });
	scene.createDirectionalLight({ intensity: 2.6, castShadows: false });
	quality.set({
		minRenderScale: 1,
		maxRenderScale: 1,
		governor: false,
		lodThreshold: 1,
		lodFade: false,
	});
	const crownY = (CROWN_HEIGHT[kind] ?? 6) * size;
	const camera = scene.createPerspectiveCamera({ fov: 45, near: 0.3, far: 4000 });
	poseFor(camera, crownY);
	scene.setActiveCamera(camera);
	if (mode === 'card') {
		// The card that the scene's far copies draw: the atlases that the build baked from this plant.
		const card = await loadPlantCard(ctx, kind === 'oleander' ? 'shrubs' : 'trees', kind);
		if (!card) throw new Error(`the samples hold no baked card for ${kind}`);
		createImpostors(ctx, {
			color: card.color,
			surface: card.surface,
			atlas: card.atlas,
			positions: [0, 0, 0],
			size: [card.size[0] * size, card.size[1] * size],
			room: card.room,
			depth: card.depth,
			castShadows: false,
		});
		ctx.page.post('ready', { kind, mode, distance });
		return { onUpdate() {} };
	}
	const prefab = await assets.loadGltf(glb);
	const part = partsOf(prefab);
	const model = {
		wood: part(`${kind}-wood`),
		leaves: part(`${kind}-leaves`),
	};
	// The two levels that the island draws, cut at once, so the mesh here is the last one that its
	// card replaces there. The file's own coarsest level never draws in the scene.
	for (const part of [model.wood, model.leaves]) {
		const levels = part.mesh.levels;
		if (levels.length > 0)
			part.mesh.setLevels(
				levels.slice(0, 2).map((level) => ({ ...level, fade: false })),
				{ fade: false },
			);
	}
	const wind = createWind(ctx, { camera, box: 160, grid: 64 });
	const sway = createSway(ctx, { wind });
	const stands = [{ x: 0, y: 0, z: 0, yaw: 0, size }];
	const look = SWAY[kind] ?? { sway: 0.02, stiffness: 2, rustle: 0.02 };
	const bark = { ...look, rustle: 0, roughness: 1 };
	standPart(ctx, model.wood, stands, swayingPart(sway, model.wood, bark, false));
	standPart(ctx, model.leaves, stands, swayingPart(sway, model.leaves, look, true));
	ctx.page.post('ready', { kind, mode, distance });
	return { onUpdate() {} };
});
