// The null3D side of the desert. It loads the ground and the props as this checkout's asset tool
// wrote them, draws the ground once, and draws every other mesh as an instance batch with a row for
// each placement. The camera follows the view's path. The page's switches reach this module's
// address: `view` picks the path, `shadows` turns the sun's shadows on in that many cascades, and
// `lod` and `lodShadow` set the level of detail thresholds in pixels and in shadow texels.
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
} from '../../scenes/desert';

const switches = new URL(import.meta.url).searchParams;
const view = readDesertView(switches);
const cascades = switches.has('shadows') ? Number(switches.get('shadows')) : 0;
const shadows = cascades > 0;
const lod = switches.get('lod');
const lodShadow = switches.get('lodShadow');

/** A linear color of the scene module as the engine's color array. */
const rgb = (c: readonly number[]): [number, number, number] => [
	c[0] as number,
	c[1] as number,
	c[2] as number,
];

export default defineSketch(async ({ scene, assets, post, quality, time, debug }) => {
	// A production build counts the triangles of draws that the GPU culls only while the sketch asks
	// for the frame figures, so the sketch asks once and the measure reports them in every build.
	debug.frameStats();
	post.set({ toneMapping: 'none' });
	quality.set({
		minRenderScale: 1,
		governor: false,
		...(lod !== null && { lodThreshold: Number(lod) }),
		...(lodShadow !== null && { lodShadowThreshold: Number(lodShadow) }),
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

	// Each row is the placement applied after the node's own transform, which holds the asset
	// tool's dequantization: the node's offset turns and scales with the row.
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

	const place = () => {
		const { position, target } = desertCamera(view, time.now);
		camera.setPosition(...position);
		camera.lookAt(...target);
	};
	place();
	return { onUpdate: place };
});
