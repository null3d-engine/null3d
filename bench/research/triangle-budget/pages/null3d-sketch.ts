// The desert's null3D scene for the triangle budget study: the benchmark's sketch, with the camera
// held at a time of the lap that the page sends. The page posts `set` with `{ t }`, and the sketch
// answers `placed`. The sketch's address carries `shadows`, the sun's shadow cascades, and `lod`
// and `lodShadow`, the level thresholds, which the sketch sets before it loads the scene: a change
// of either threshold after the desert's ground has loaded leaves that ground undrawn (the ground
// draws from a tree of cluster patches), so each setting takes a page of its own.
import { defineSketch, quat, vec3 } from '@null3d/engine';
import {
	DESERT_CAMERA,
	DESERT_FILES,
	DESERT_SHADOWS,
	DESERT_SKY,
	DESERT_SUN,
	desertCamera,
	desertModelPath,
	desertPlacements,
	GROUND,
	ROW_FLOATS,
	readDesertView,
} from '../../../scenes/desert';

const switches = new URL(import.meta.url).searchParams;
const view = readDesertView(switches);
const cascades = switches.has('shadows') ? Number(switches.get('shadows')) : 0;
const shadows = cascades > 0;
const lod = Number(switches.get('lod') ?? 1);
const lodShadow = Number(switches.get('lodShadow') ?? 1);
// Meters to raise the camera by, for checks by eye; the study's frames leave it at 0.
const lift = Number(switches.get('lift') ?? 0);

const rgb = (c: readonly number[]): [number, number, number] => [
	c[0] as number,
	c[1] as number,
	c[2] as number,
];

export default defineSketch(async ({ scene, assets, post, quality, debug, page }) => {
	debug.frameStats();
	post.set({ toneMapping: 'none' });
	quality.set({
		minRenderScale: 1,
		governor: false,
		lodThreshold: lod,
		lodShadowThreshold: lodShadow,
	});
	scene.setBackground(rgb(DESERT_SKY.color));
	scene.createDirectionalLight({
		direction: [...DESERT_SUN.direction],
		color: rgb(DESERT_SUN.color),
		intensity: DESERT_SUN.intensity,
		castShadows: shadows,
		...(shadows && {
			shadow: { cascades, mapSize: DESERT_SHADOWS.mapSize, distance: DESERT_SHADOWS.distance },
		}),
	});
	scene.createAmbientLight({ intensity: DESERT_SKY.ambient });
	const camera = scene.createPerspectiveCamera({ ...DESERT_CAMERA });
	scene.setActiveCamera(camera);

	const files = await Promise.all(
		DESERT_FILES.map((file) =>
			assets.loadGltf(new URL(desertModelPath('null3d', file), import.meta.url).href),
		),
	);
	const find = (name: string) => {
		for (const file of files) {
			const node = file.find(name);
			if (node?.mesh && node.material) return { ...node, mesh: node.mesh, material: node.material };
		}
		throw new Error(`the desert's null3D files hold no mesh named ${name}`);
	};

	const ground = find(GROUND);
	scene.createMesh({
		mesh: ground.mesh,
		material: ground.material,
		position: ground.position,
		rotation: ground.rotation,
		scale: ground.scale,
		castShadows: shadows,
		receiveShadows: shadows,
	});

	const offset = vec3.create();
	const q = quat.create();
	for (const [name, list] of Object.entries(desertPlacements())) {
		const node = find(name);
		const count = list.length / ROW_FLOATS;
		const batch = scene.createInstances(node.mesh, count, {
			material: node.material,
			castShadows: shadows,
			receiveShadows: shadows,
		});
		const { positions, rotations, scales } = batch;
		const [nx, ny, nz] = node.position;
		const [sx, sy, sz] = node.scale;
		for (let i = 0; i < count; i++) {
			const o = i * ROW_FLOATS;
			const s = list[o + 7] as number;
			q[0] = list[o + 3] as number;
			q[1] = list[o + 4] as number;
			q[2] = list[o + 5] as number;
			q[3] = list[o + 6] as number;
			vec3.transformQuat(offset, vec3.set(offset, nx * s, ny * s, nz * s), q);
			positions[i * 3] = (list[o] as number) + offset[0];
			positions[i * 3 + 1] = (list[o + 1] as number) + offset[1];
			positions[i * 3 + 2] = (list[o + 2] as number) + offset[2];
			quat.multiply(q, q, node.rotation);
			rotations.set(q, i * 4);
			scales[i * 3] = sx * s;
			scales[i * 3 + 1] = sy * s;
			scales[i * 3 + 2] = sz * s;
		}
	}

	let held = Number(switches.get('at') ?? 0);
	// While the page measures, the camera sways by a millimeter, so that the engine draws each frame
	// as a moving camera does rather than its still-camera frames.
	let sway = false;
	let frame = 0;
	const place = () => {
		const { position, target } = desertCamera(view, held);
		const dx = sway ? (frame++ % 2) * 0.001 : 0;
		camera.setPosition(position[0] + dx, position[1] + lift, position[2]);
		camera.lookAt(target[0] + dx, target[1], target[2]);
	};
	place();
	page.onMessage((type, data) => {
		if (type === 'sway') {
			sway = (data as { on: boolean }).on;
			return;
		}
		if (type !== 'set') return;
		// The next update places the camera.
		held = (data as { t: number }).t;
		page.post('placed', { t: held });
	});
	page.post('ready');
	return { onUpdate: place };
});
