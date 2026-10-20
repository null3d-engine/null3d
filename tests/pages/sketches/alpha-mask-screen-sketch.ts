// A masked card stands about 0.3 m in front of a patch of thin blades on the ground, with ambient
// occlusion and contact shadows on, as the Creek's petals stand in front of its grass. The depth
// prepass leaves masked surfaces out, so the half-size screen texture of ambient occlusion and
// contact shadows holds the blades behind the card. No texel there lies at the card's depth, and
// the card must take none of their values: it shows its own light, with no blocks. Before masked
// surfaces took no screen values in that case, the card showed the blades' contact shadows and
// occlusion in blocks of the texture's texels.
import { defineSketch } from '@null3d/engine';

/** The blades of the patch, in rows across the view. */
const ROWS = 6;
const PER_ROW = 28;

export default defineSketch(({ scene, materials, geometry, quality, post, textures }) => {
	quality.set({ governor: false, contactShadowSteps: 8, aoScale: 0.5 });
	post.set({ ao: { radius: 0.3 } });
	scene.setBackground('#9fb4c8');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			position: [0, 0.55, 1.9],
			target: [0, 0.2, 0],
			near: 0.1,
			far: 100,
		}),
	);
	scene.createDirectionalLight({
		direction: [0.45, -0.55, -0.7],
		color: '#fff1dc',
		intensity: 3,
		castShadows: true,
		shadow: { cascades: 2, mapSize: 1024, distance: 20, contactDistance: 0.3 },
	});
	scene.createAmbientLight({ color: '#c8d8ff', intensity: 0.6 });
	const solid = { castShadows: true, receiveShadows: true };
	scene.createMesh({
		mesh: geometry.box({ width: 20, height: 0.2, depth: 20 }),
		material: materials.standard({ color: '#7f8f55', roughness: 0.95 }),
		position: [0, -0.1, 0],
		receiveShadows: true,
	});
	// Upright blades of varied heights, placed by a fixed sequence so that every run draws them
	// alike.
	const blade = geometry.box({ width: 0.012, height: 1, depth: 0.012 });
	const green = materials.standard({ color: '#4f7a35', roughness: 0.8 });
	for (let row = 0; row < ROWS; row++)
		for (let k = 0; k < PER_ROW; k++) {
			const step = (row * PER_ROW + k) * 0.618034;
			const jitter = step - Math.floor(step);
			const height = 0.22 + 0.2 * jitter;
			scene.createMesh({
				mesh: blade,
				material: green,
				position: [-0.7 + (k + jitter * 0.6) * 0.05, height / 2, -0.15 - row * 0.06],
				scale: [1, height, 1],
				...solid,
			});
		}
	// A white map with a round cut-out, for the card.
	const size = 32;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
			data.set([240, 240, 240, r < 0.9 ? 255 : 0], (y * size + x) * 4);
		}
	const map = textures.fromData({ width: size, height: size, data, colorSpace: 'srgb' });
	scene.createMesh({
		mesh: geometry.plane({ width: 0.42, height: 0.42 }),
		material: materials.standard({
			color: '#ffd84d',
			map,
			alphaMode: 'mask',
			alphaCutoff: 0.5,
			alphaToCoverage: false,
			doubleSided: true,
		}),
		position: [0, 0.27, 0.2],
		receiveShadows: true,
	});
	return {};
});
