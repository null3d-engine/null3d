// The three.js page of the triangle budget study: the desert's three.js r187 meshlet page, with the
// camera held at a time of the lap and the pipeline's level thresholds that the runner sets. It
// draws every animation frame and gives the runner `globalThis.__tb`:
// - `set(t, lod, lodShadow)` holds the camera at time t with `lodThreshold` and `shadowLodThreshold`;
// - `shot()` draws one frame and returns it as a PNG file in base64;
// - `measure(seconds)` returns the median main-view triangles, shadow triangles and GPU time.
// The pipeline counts only the main view's triangles in `info.triangles`. The study's server
// patches it to keep each shadow pass's latest count in `info.shadowTriangles`, by culling record.
// Switches: `?view=walk|aerial`, `?shadows=1` for the one shadow map of the benchmark page.
import { GLTFLoader } from 'three-r187/addons/loaders/GLTFLoader.js';
import { MeshletDrawingPipeline } from 'three-r187/addons/pipelines/MeshletDrawingPipeline.js';
import * as THREE from 'three-r187/webgpu';
import {
	DESERT_CAMERA,
	DESERT_CANVAS,
	DESERT_FILES,
	DESERT_MATERIALS,
	DESERT_SHADOWS,
	DESERT_SKY,
	DESERT_SUN,
	type DesertMaterial,
	desertCamera,
	desertModelPath,
	desertPlacements,
	GROUND,
	ROW_FLOATS,
	readDesertView,
	THREE_MESHLETS,
} from '../../../scenes/desert';

const SUN_DISTANCE = 400;
const params = new URLSearchParams(location.search);
const status = document.querySelector('#status') as HTMLElement;
const view = readDesertView(params);
const shadows = params.has('shadows');

const linear = (c: readonly number[]) =>
	new THREE.Color().setRGB(
		c[0] as number,
		c[1] as number,
		c[2] as number,
		THREE.LinearSRGBColorSpace,
	);

const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) throw new Error('This browser gives no WebGPU adapter.');
const canvas = document.createElement('canvas');
document.body.append(canvas);
const gpu = new THREE.WebGPURenderer({
	canvas,
	antialias: true,
	trackTimestamp: true,
	powerPreference: 'high-performance',
	requiredLimits: {
		maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
		maxBufferSize: adapter.limits.maxBufferSize,
	},
});
await gpu.init();
gpu.setPixelRatio(DESERT_CANVAS.pixelRatio);
gpu.setSize(DESERT_CANVAS.width, DESERT_CANVAS.height);
gpu.toneMapping = THREE.NoToneMapping;
gpu.shadowMap.enabled = shadows;
const pipeline = new MeshletDrawingPipeline({ ...THREE_MESHLETS });
(gpu as unknown as { drawingPipeline: unknown }).drawingPipeline = pipeline;
const info = pipeline.info as { triangles: number; shadowTriangles?: Map<unknown, number> };
/** The shadow map's triangles in a frame: the latest count of each of its culling records, summed. */
const shadowTriangles = () =>
	info.shadowTriangles ? [...info.shadowTriangles.values()].reduce((a, b) => a + b, 0) : null;

const scene = new THREE.Scene();
scene.background = linear(DESERT_SKY.color);
const sun = new THREE.DirectionalLight(linear(DESERT_SUN.color), DESERT_SUN.intensity);
const [dx, dy, dz] = DESERT_SUN.direction;
scene.add(sun, sun.target, new THREE.AmbientLight(0xffffff, DESERT_SKY.ambient));
const camera = new THREE.PerspectiveCamera(
	DESERT_CAMERA.fov,
	DESERT_CANVAS.width / DESERT_CANVAS.height,
	DESERT_CAMERA.near,
	DESERT_CAMERA.far,
);
if (shadows) {
	sun.castShadow = true;
	const half = DESERT_SHADOWS.distance;
	sun.shadow.mapSize.set(DESERT_SHADOWS.threeMapSize, DESERT_SHADOWS.threeMapSize);
	Object.assign(sun.shadow.camera, {
		left: -half,
		right: half,
		top: half,
		bottom: -half,
		near: 1,
		far: 2 * SUN_DISTANCE,
	});
	sun.shadow.camera.updateProjectionMatrix();
}

const materials = Object.fromEntries(
	Object.entries(DESERT_MATERIALS).map(([name, { color, roughness }]) => [
		name,
		new THREE.MeshStandardNodeMaterial({ color: linear(color), roughness, metalness: 0 }),
	]),
) as Record<DesertMaterial, THREE.MeshStandardNodeMaterial>;
const loader = new GLTFLoader();
const files = await Promise.all(
	DESERT_FILES.map((file) => loader.loadAsync(desertModelPath('raw', file))),
);
const find = (name: string): THREE.Mesh => {
	for (const file of files) {
		const node = file.scene.getObjectByName(name);
		if (node instanceof THREE.Mesh) return node;
	}
	throw new Error(`the desert's raw files hold no mesh named ${name}`);
};
const materialOf = (mesh: THREE.Mesh) =>
	materials[(mesh.material as THREE.Material).name as DesertMaterial];
const groundSource = find(GROUND);
const ground = new THREE.Mesh(groundSource.geometry, materialOf(groundSource));
ground.castShadow = ground.receiveShadow = shadows;
scene.add(ground);
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();
for (const [name, list] of Object.entries(desertPlacements())) {
	const source = find(name);
	const count = list.length / ROW_FLOATS;
	const batch = new THREE.InstancedMesh(source.geometry, materialOf(source), count);
	for (let i = 0; i < count; i++) {
		const row = list.subarray(i * ROW_FLOATS, (i + 1) * ROW_FLOATS);
		position.fromArray(row, 0);
		rotation.fromArray(row, 3);
		scale.setScalar(row[7] as number);
		batch.setMatrixAt(i, matrix.compose(position, rotation, scale));
	}
	batch.instanceMatrix.needsUpdate = true;
	batch.computeBoundingSphere();
	batch.castShadow = batch.receiveShadow = shadows;
	scene.add(batch);
}

const place = (seconds: number) => {
	const { position: p, target: t } = desertCamera(view, seconds);
	camera.position.set(...p);
	camera.lookAt(...t);
	if (shadows) {
		sun.target.position.set(...p);
		sun.position.set(p[0] - dx * SUN_DISTANCE, p[1] - dy * SUN_DISTANCE, p[2] - dz * SUN_DISTANCE);
		sun.target.updateMatrixWorld();
	}
};
place(0);
await gpu.compileAsync(scene, camera);

// Every animation frame draws the held view. The GPU times land a few frames later.
let frames = 0;
let sampling: {
	gpu: number[];
	triangles: number[];
	shadow: number[];
	frameStart: number;
} | null = null;
const loop = () => {
	gpu.render(scene, camera);
	frames++;
	if (sampling) {
		sampling.triangles.push(info.triangles);
		const shadow = shadowTriangles();
		if (shadow !== null) sampling.shadow.push(shadow);
		const s = sampling;
		Promise.all([gpu.resolveTimestampsAsync('render'), gpu.resolveTimestampsAsync('compute')]).then(
			([render, compute]) => {
				if (render !== undefined) s.gpu.push(render + (compute ?? 0));
			},
		);
	}
	requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
const waitFrames = (n: number) =>
	new Promise<void>((resolve) => {
		const until = frames + n;
		const check = () => (frames >= until ? resolve() : requestAnimationFrame(check));
		check();
	});
const median = (values: number[]) => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] as number;
};
const toBase64 = async (blob: Blob) => {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let text = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
};
const copy = document.createElement('canvas');
copy.width = DESERT_CANVAS.width;
copy.height = DESERT_CANVAS.height;
const copyContext = copy.getContext('2d') as CanvasRenderingContext2D;

(globalThis as Record<string, unknown>).__tb = {
	engine: 'three',
	async set(t: number, lod: number, lodShadow: number) {
		place(t);
		pipeline.lodThreshold = lod;
		pipeline.shadowLodThreshold = lodShadow;
		// Two-phase occlusion and the culling buffers' sizes settle within a few frames.
		await waitFrames(30);
	},
	async shot() {
		await waitFrames(2);
		// The canvas's current image can be read in the task that drew it.
		gpu.render(scene, camera);
		copyContext.drawImage(canvas, 0, 0);
		const blob = await new Promise<Blob>((resolve) =>
			copy.toBlob((b) => resolve(b as Blob), 'image/png'),
		);
		return { png: await toBase64(blob) };
	},
	async measure(seconds: number) {
		const s = {
			gpu: [] as number[],
			triangles: [] as number[],
			shadow: [] as number[],
			frameStart: frames,
		};
		sampling = s;
		await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
		sampling = null;
		const counted = frames - s.frameStart;
		return {
			triangles: median(s.triangles),
			shadowTriangles: median(s.shadow),
			gpuMs: median(s.gpu),
			frames: counted,
		};
	},
};
status.textContent = 'ready';
(globalThis as Record<string, unknown>).__tbReady = true;
