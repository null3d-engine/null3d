// A still camera over a row of plants whose material sways, for the shadow redraw count. The row
// stands past the near cascades, so only a far cascade holds it. ?sway= is the distance from the
// camera out to which the plants' material keeps the wind's vertex offset: a large distance reaches
// the far cascade, which then redraws in every frame, while a distance shorter than the row lets
// the cascade keep its layer and take only its scheduled turns. The page measures the frame's draw
// calls, and the sketch posts what it built so a run cannot read a page that ignored its query.
import { defineSketch } from '@null3d/engine';
import {
	growPlant,
	loadSpeciesOrStandIn,
	placePlants,
	plantMaterials,
	prepareSpecies,
	setWindLayer,
} from '@null3d/vegetation';
import { createWind } from '@null3d/wind';

const params = new URL(import.meta.url).searchParams;
/** Metres from the camera out to which the plants' material keeps its wind offset. */
const SWAY = Math.max(0.001, Number(params.get('sway') ?? 1));
/** The wind's strength: 0 still, up to 3. */
const WIND = Math.max(0, Math.min(3, Number(params.get('wind') ?? 2)));
/** The plants in the row. */
const PLANTS = Math.max(1, Number(params.get('plants') ?? 12));
/** Metres from the camera to the row, past the near cascades. */
const DISTANCE = Math.max(10, Number(params.get('distance') ?? 40));
/** Metres between two plants of the row. */
const ACROSS = 3;
/** The ground plane's rotation, which lays it flat. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, quality, page } = ctx;
	// The far cascades keep the preset's interval, so a governor step cannot change the count.
	quality.set({ governor: false });
	scene.setBackground('#c5d8ef');
	scene.createMesh({
		mesh: geometry.plane({ width: 400, height: 400 }),
		material: materials.standard({ color: '#9e9b62', roughness: 1 }),
		rotation: FLAT,
		receiveShadows: true,
	});
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.5,
		far: 200,
		position: [0, 8, 0],
		target: [0, 3, DISTANCE],
	});
	scene.setActiveCamera(camera);
	// Shadows reach past the row, and the preset's three cascades put the row in a far one.
	scene.createDirectionalLight({
		direction: [-0.4, -1, -0.3],
		intensity: 3,
		castShadows: true,
		shadow: { distance: 160, contactDistance: 0.5 },
	});
	scene.createAmbientLight({ intensity: 0.6 });
	scene.createHemisphereLight({
		skyColor: '#dfe8f0',
		groundColor: '#7f8166',
		intensity: 1.5,
	});
	const wind = createWind(ctx, {
		camera,
		box: 200,
		grid: 64,
		air: { speed: 4 * WIND },
	});
	const module = await loadSpeciesOrStandIn('hawthorn-shrub');
	const kit = await prepareSpecies(ctx, module, { detail: 'low', placeholders: 'missing' });
	const asset = await growPlant(kit, { seed: 11, variant: 0, near: true });
	const look = plantMaterials(ctx, kit, { wind: wind.field, swayDistance: SWAY });
	const labels = Object.values(look);
	// Each plant is its own batch, so the far cascade's caster list holds one draw call for each.
	for (let i = 0; i < PLANTS; i++) {
		const x = (i - (PLANTS - 1) / 2) * ACROSS;
		placePlants(
			ctx,
			kit,
			[asset],
			{
				count: 1,
				position: new Float32Array([x, 0, DISTANCE]),
				turn: new Float32Array([i * 0.7]),
				scale: new Float32Array([1]),
				variant: new Uint8Array([0]),
			},
			{
				materials: look,
				view: { height: 540, fov: 45 },
				castShadows: true,
			},
		);
	}
	page.post('plant-shadow', { sway: SWAY, wind: WIND, plants: PLANTS, distance: DISTANCE });
	return {
		onUpdate() {
			wind.update();
			setWindLayer(labels, wind.field);
		},
	};
});
