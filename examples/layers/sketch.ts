// Render layers: a street of cottages in the low sun of late afternoon, with furniture inside,
// roofs on a layer of their own, and map pins on a third layer. Every 2 seconds the camera changes
// the layers it draws: the street with its roofs, then with the pins too, then without the roofs,
// which shows the rooms. A new mask changes no table of what the engine draws, so a sketch can
// change layers in any frame. One brick texture made in code covers the walls, the roof tiles and
// the cobbles, in three tints.
import {
	defineSketch,
	type Material,
	type MeshOptions,
	math,
	timeOfDay,
	type Vec3,
} from '@null3d/engine';
import { interact } from '../lib/interact';

/** The ground, the walls, the furniture, the trees and the lamps. */
const STREET = 1 << 0;
const ROOFS = 1 << 1;
const PINS = 1 << 2;
/** The masks that the camera cycles through. */
const VIEWS = [STREET | ROOFS, STREET | ROOFS | PINS, STREET | PINS];
/** How long the camera keeps each mask, in seconds. */
const STEP = 2;
const HOUSES = 5;
/** The pitch of each roof, in radians. */
const PITCH = 0.55;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	const day = timeOfDay(16.6, { heading: 1 });
	const sky = { ...day.sky, cloudCoverage: 0.25 };
	scene.setBackground({ sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.008, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure, bloom: { threshold: 1 }, ao: {}, vignette: {} });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 40 } });
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		far: 1000,
		position: [3, 5.5, 10],
		target: [0, 0.5, 0],
		layers: VIEWS[0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.5, 0], maxPolarAngle: Math.PI * 0.45 });

	// Bricks in rows, each row half a brick along from the one before, with darker mortar between.
	math.seed(4);
	const data = new Uint8Array(64 * 64 * 4).fill(255);
	for (let y = 0; y < 64; y++)
		for (let x = 0; x < 64; x++) {
			const row = Math.floor(y / 8);
			const along = (x + (row % 2) * 8) % 16;
			const shade = y % 8 === 0 || along === 0 ? 0.55 : 0.7 + 0.2 * Math.sin(row * 5 + x);
			data.fill(shade * math.randFloat(0.9, 1) * 255, (y * 64 + x) * 4, (y * 64 + x) * 4 + 3);
		}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const map = textures.fromData({ width: 64, height: 64, data, ...look });
	const bricks = (color: string, repeat: [number, number]) =>
		materials.standard({ map, color, roughness: 0.85, uvTransform: { repeat } });
	const wall = bricks('#f2dcc0', [1.5, 1]);
	const tiles = bricks('#b0432c', [3, 2]);
	const box = geometry.box();
	const solid = { castShadows: true, receiveShadows: true };
	const part = (material: Material, position: Vec3, scale: Vec3, more: Partial<MeshOptions> = {}) =>
		scene.createMesh({ mesh: box, material, position, scale, ...solid, ...more });

	scene.createMesh({
		mesh: geometry.plane({ width: 2000, height: 2000 }),
		material: materials.standard({ color: '#5f8f3f', doubleSided: true }),
		position: [0, -0.01, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	part(bricks('#9a948c', [20, 1.5]), [0, 0.02, 2.4], [18, 0.04, 1.6]);
	const floor = materials.standard({ color: '#9b6b43', roughness: 0.6 });
	const furniture = ['#4a8cff', '#5bc27a', '#f2c14e'].map((color) =>
		materials.standard({ color, roughness: 0.7 }),
	);
	for (let h = 0; h < HOUSES; h++) {
		const house = scene.createGroup({ position: [(h - (HOUSES - 1) / 2) * 3.2, 0, 0] });
		const parent = { parent: house };
		part(floor, [0, 0.05, 0], [2.4, 0.1, 2.4], parent);
		// Three walls on the floor, open at the front, low enough to look over. The back wall fits
		// between the side walls, so no two faces share a plane and flicker.
		part(wall, [0, 0.625, -1.15], [2.2, 1.05, 0.1], parent);
		part(wall, [-1.15, 0.625, 0], [0.1, 1.05, 2.4], parent);
		part(wall, [1.15, 0.625, 0], [0.1, 1.05, 2.4], parent);
		// A table and a bed in a color of their own.
		part(floor, [-0.5, 0.35, -0.4], [0.8, 0.5, 0.5], parent);
		part(furniture[h % furniture.length], [0.6, 0.25, 0.3], [0.6, 0.3, 1.2], parent);
		// The roof's two sides meet at the ridge. They are on their own layer, so the camera can
		// leave them out.
		for (const side of [-1, 1]) {
			const rotation = [side * Math.sin(PITCH / 2), 0, 0, Math.cos(PITCH / 2)] as const;
			part(tiles, [0, 1.45, side * 0.74], [2.8, 0.08, 1.8], { ...parent, rotation, layers: ROOFS });
		}
	}
	// Trees behind the street, and lamps along it whose bulbs glow bright enough to bloom.
	const trunk = materials.standard({ color: '#5a3d26' });
	const leaves = materials.standard({ color: '#3f6b2a' });
	const crown = geometry.sphere({ radius: 1 });
	for (let k = 0; k < 6; k++) {
		const x = (k - 2.5) * 3.2 + math.randFloat(-0.5, 0.5);
		part(trunk, [x, 0.6, -3.2], [0.18, 1.2, 0.18]);
		const size = math.randFloat(0.8, 1.1);
		const scale: Vec3 = [size, size * 1.2, size];
		scene.createMesh({ mesh: crown, material: leaves, position: [x, 1.6, -3.2], scale, ...solid });
	}
	const bulb = materials.standard({ color: '#000000', emissive: '#ffb45c', emissiveIntensity: 8 });
	for (let k = 0; k < HOUSES - 1; k++) {
		const x = (k - (HOUSES - 2) / 2) * 3.2;
		part(trunk, [x, 0.9, 1.6], [0.06, 1.8, 0.06]);
		part(bulb, [x, 1.85, 1.6], [0.12, 0.12, 0.12], { mesh: crown, castShadows: false });
		scene.createPointLight({ position: [x, 1.85, 1.6], color: '#ffb45c', intensity: 3, range: 5 });
	}

	// One pin above each house. Every row of a batch shares the batch's layers.
	const pins = scene.createInstances(geometry.sphere({ radius: 0.25 }), HOUSES, {
		material: materials.standard({ color: '#e8323a', roughness: 0.3, emissive: '#ff2020' }),
		layers: PINS,
	});
	for (let h = 0; h < HOUSES; h++)
		pins.positions.set([(h - (HOUSES - 1) / 2) * 3.2, 2.9, 0], h * 3);

	let shown = 0;
	return {
		onUpdate(dt) {
			view.update(dt);
			const next = Math.floor(time.now / STEP) % VIEWS.length;
			if (next === shown) return;
			shown = next;
			camera.setLayers(VIEWS[shown]);
		},
	};
});
