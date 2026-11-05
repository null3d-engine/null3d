// The null3D side of the desert comparison. It loads the ground and the props as the asset tool
// wrote them, draws the ground once, and draws every other mesh as an instance batch with a row for
// each placement. The camera follows the shared path. The page's switches reach this module's
// address: `view` picks the path, `models` the folder of the asset tool's files, `shadows` turns
// the sun's shadows on, `occluder` marks the ground as an occluder for GPU occlusion culling, and
// `only` draws only the meshes whose names start with one of its comma-separated values, to count
// some kinds' triangles.
import { defineSketch, quat } from '/cdn/lib/index.js';
import { cameraAt, FAR, FOV_DEGREES, NEAR, placements, SHADOWS, SKY, SUN } from './desert.js';

const params = new URL(import.meta.url).searchParams;
const view = params.get('view') ?? 'walk';
const models = params.get('models') ?? '/models/null3d';
const shadows = params.get('shadows') === '1';
const occluder = params.get('occluder') === '1';
const hold = params.has('hold') ? Number(params.get('hold')) : null;
const only = params.get('only');
const drawn = (name) => only === null || only.split(',').some((prefix) => name.startsWith(prefix));

/** The page's linear color as the engine's color array. */
const rgb = (c) => [c[0], c[1], c[2]];

export default defineSketch(async ({ scene, assets, post, quality, time, page, debug }) => {
	// A production build counts the triangles of draws that the GPU culls only while the sketch asks
	// for the frame figures, so the page asks once and the measure reports them in every build.
	debug.frameStats();
	post.set({ toneMapping: 'none' });
	quality.set({ minRenderScale: 1, governor: false });
	scene.setBackground(rgb(SKY.color));
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: rgb(SUN.color),
		intensity: SUN.intensity,
		castShadows: shadows,
		...(shadows && { shadow: { ...SHADOWS } }),
	});
	scene.createAmbientLight({ intensity: SKY.ambient });
	const camera = scene.createPerspectiveCamera({ fov: FOV_DEGREES, near: NEAR, far: FAR });
	scene.setActiveCamera(camera);

	const files = models.endsWith('.glb')
		? [await assets.loadGltf(models)]
		: await Promise.all([
				assets.loadGltf(`${models}/ground/ground.glb`),
				assets.loadGltf(`${models}/props/props.glb`),
			]);
	const find = (name) => {
		for (const file of files) {
			const node = file.find(name);
			if (node) return node;
		}
		throw new Error(`no mesh named ${name} in ${models}`);
	};

	const ground = find('ground');
	if (drawn('ground'))
		scene.createMesh({
			mesh: ground.mesh,
			material: ground.material,
			position: ground.position,
			rotation: ground.rotation,
			scale: ground.scale,
			castShadows: shadows,
			receiveShadows: shadows,
			occluder,
		});

	// Each row is the placement applied after the node's own transform, which holds the asset
	// tool's dequantization: the node's offset turns and scales with the row.
	const rows = placements();
	const turned = new Float64Array(3);
	const q = quat.create();
	let copies = 0;
	for (const [name, list] of Object.entries(rows)) {
		if (!drawn(name)) continue;
		const node = find(name);
		const count = list.length / 8;
		copies += count;
		const batch = scene.createInstances(node.mesh, count, {
			material: node.material,
			castShadows: shadows,
			receiveShadows: shadows,
		});
		const positions = batch.positions;
		const rotations = batch.rotations;
		const scales = batch.scales;
		const [nx, ny, nz] = node.position;
		const nodeRotation = node.rotation;
		const [sx, sy, sz] = node.scale;
		for (let i = 0; i < count; i++) {
			const o = i * 8;
			const s = list[o + 7];
			q[0] = list[o + 3];
			q[1] = list[o + 4];
			q[2] = list[o + 5];
			q[3] = list[o + 6];
			rotateVector(turned, q, nx * s, ny * s, nz * s);
			positions[i * 3] = list[o] + turned[0];
			positions[i * 3 + 1] = list[o + 1] + turned[1];
			positions[i * 3 + 2] = list[o + 2] + turned[2];
			multiply(rotations, i * 4, q, nodeRotation);
			scales[i * 3] = sx * s;
			scales[i * 3 + 1] = sy * s;
			scales[i * 3 + 2] = sz * s;
		}
	}
	page.post('scene', { copies });

	const place = () => {
		const { position, target } = cameraAt(view, hold ?? time.now);
		camera.setPosition(position[0], position[1], position[2]);
		camera.lookAt(target[0], target[1], target[2]);
	};
	place();
	return { onUpdate: place };
});

/** Writes the vector turned by the quaternion into `out`. */
function rotateVector(out, q, x, y, z) {
	const [qx, qy, qz, qw] = q;
	const tx = 2 * (qy * z - qz * y);
	const ty = 2 * (qz * x - qx * z);
	const tz = 2 * (qx * y - qy * x);
	out[0] = x + qw * tx + (qy * tz - qz * ty);
	out[1] = y + qw * ty + (qz * tx - qx * tz);
	out[2] = z + qw * tz + (qx * ty - qy * tx);
}

/** Writes the product a × b of two quaternions into `out` at `offset`. */
function multiply(out, offset, a, b) {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	out[offset] = aw * bx + ax * bw + ay * bz - az * by;
	out[offset + 1] = aw * by - ax * bz + ay * bw + az * bx;
	out[offset + 2] = aw * bz + ax * by - ay * bx + az * bw;
	out[offset + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
