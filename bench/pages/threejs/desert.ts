// The three.js side of the desert, on r187 through the bench's `three-r187` alias, apart from the
// r186 that every other twin runs. WebGPURenderer draws with MSAA at a pixel ratio of 1, from the
// raw model files, through the meshlet drawing pipeline: each copy picks a whole level, then the GPU
// culls each 64-triangle meshlet by frustum, normal cone and two-phase occlusion and draws the kept
// ones by vertex pulling. The page times its frames with the loop that every twin uses, and reads
// the GPU's render and compute times of each measured frame.
//
// Switches: `?renderer=webgpu`, the only renderer it has. `?view=walk` or `?view=aerial`.
// `?shadows=<n>` turns the sun's shadows on, in one map that covers the shadow distance around the
// camera. `?csm=on` draws them in n cascades through three.js's cascaded shadow node instead, which
// the meshlet pipeline drew as an empty frame. `?pipeline=standard` draws with the standard pipeline,
// with no meshlets.
import { CSMShadowNode } from 'three-r187/addons/csm/CSMShadowNode.js';
import { GLTFLoader } from 'three-r187/addons/loaders/GLTFLoader.js';
import { MeshletDrawingPipeline } from 'three-r187/addons/pipelines/MeshletDrawingPipeline.js';
import * as THREE from 'three-r187/webgpu';
import { median } from '../../../packages/cli/src/protocol.js';
import { run } from '../../../tests/pages/lib/result';
import {
	DESERT_CAMERA,
	DESERT_CANVAS,
	DESERT_COUNT,
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
} from '../../scenes/desert';
import type { DesertFigures } from '../lib/desert';
import { fitToWindow, showPageName } from '../lib/fit';
import { measureFrames } from '../lib/measure';
import { pageReport, readChoice, readRunOptions } from '../lib/options';

/** How far the sun stands from the point its one shadow map centers on, in meters. */
const SUN_DISTANCE = 400;

const linear = (c: readonly number[]) =>
	new THREE.Color().setRGB(
		c[0] as number,
		c[1] as number,
		c[2] as number,
		THREE.LinearSRGBColorSpace,
	);

const params = new URLSearchParams(location.search);
showPageName();
run(pageReport(params), async () => {
	const options = readRunOptions(params);
	if (options.hold !== null || options.demo || options.keep || options.soak !== null)
		throw new Error(
			"The desert's three.js page runs timed runs only: leave out ?hold, ?demo, ?keep and ?soak.",
		);
	const renderer = readChoice(params, 'renderer', ['webgpu'] as const);
	const view = readDesertView(params);
	const meshlets =
		readChoice(params, 'pipeline', ['meshlets', 'standard'] as const, 'meshlets') === 'meshlets';
	const cascaded = readChoice(params, 'csm', ['on', 'off'] as const, 'off') === 'on';
	const shadows = options.shadows;

	if (!('gpu' in navigator)) throw new Error('This browser has no WebGPU.');
	// The meshlet pipeline sizes its culling buffers up to the largest storage binding, and this
	// scene's records pass the default 128 MiB, so the page asks for the adapter's own limits.
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
	// WebGPURenderer switches to its WebGL 2 backend when WebGPU fails to start, which must never
	// pass for a WebGPU run.
	if (!('isWebGPUBackend' in gpu.backend))
		throw new Error(
			'three.js could not start WebGPU and switched to WebGL 2. See the console for the cause.',
		);
	gpu.setPixelRatio(DESERT_CANVAS.pixelRatio);
	gpu.setSize(DESERT_CANVAS.width, DESERT_CANVAS.height);
	gpu.toneMapping = THREE.NoToneMapping;
	gpu.shadowMap.enabled = shadows !== null;
	const pipeline = meshlets ? new MeshletDrawingPipeline({ ...THREE_MESHLETS }) : null;
	// r186's types do not have the drawing pipeline, which r187 adds.
	if (pipeline) (gpu as unknown as { drawingPipeline: unknown }).drawingPipeline = pipeline;

	const scene = new THREE.Scene();
	scene.background = linear(DESERT_SKY.color);
	const sun = new THREE.DirectionalLight(linear(DESERT_SUN.color), DESERT_SUN.intensity);
	const [dx, dy, dz] = DESERT_SUN.direction;
	sun.position.set(-dx * SUN_DISTANCE, -dy * SUN_DISTANCE, -dz * SUN_DISTANCE);
	scene.add(sun, sun.target, new THREE.AmbientLight(0xffffff, DESERT_SKY.ambient));
	const camera = new THREE.PerspectiveCamera(
		DESERT_CAMERA.fov,
		DESERT_CANVAS.width / DESERT_CANVAS.height,
		DESERT_CAMERA.near,
		DESERT_CAMERA.far,
	);
	if (shadows !== null) {
		sun.castShadow = true;
		if (cascaded) {
			sun.shadow.mapSize.set(DESERT_SHADOWS.mapSize, DESERT_SHADOWS.mapSize);
			const node = new CSMShadowNode(sun, { cascades: shadows, maxFar: DESERT_SHADOWS.distance });
			node.camera = camera;
			sun.shadow.shadowNode = node;
		} else {
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
	ground.castShadow = ground.receiveShadow = shadows !== null;
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
		batch.castShadow = batch.receiveShadow = shadows !== null;
		scene.add(batch);
	}

	const place = (seconds: number) => {
		const { position: p, target: t } = desertCamera(view, seconds);
		camera.position.set(...p);
		camera.lookAt(...t);
		if (shadows !== null && !cascaded) {
			// The one map centers on the camera, as null3D's cascades cover the distance around it.
			sun.target.position.set(...p);
			sun.position.set(
				p[0] - dx * SUN_DISTANCE,
				p[1] - dy * SUN_DISTANCE,
				p[2] - dz * SUN_DISTANCE,
			);
			sun.target.updateMatrixWorld();
		}
	};
	place(0);
	// The meshlet pipeline builds each geometry's meshlets and levels as it prepares it.
	await gpu.compileAsync(scene, camera);
	gpu.render(scene, camera);
	await gpu.resolveTimestampsAsync('render');
	const firstFrameMs = performance.now();
	fitToWindow(canvas, DESERT_CANVAS.width, DESERT_CANVAS.height);

	// Each measured frame's GPU time lands when the GPU's timestamps come back, after the frame.
	const gpuTimes: number[] = [];
	const triangles: number[] = [];
	const timings = await measureFrames(
		(seconds) => {
			place(seconds);
			gpu.render(scene, camera);
			if (seconds < options.warmupSeconds) return;
			triangles.push(pipeline ? pipeline.info.triangles : gpu.info.render.triangles);
			Promise.all([
				gpu.resolveTimestampsAsync('render'),
				gpu.resolveTimestampsAsync('compute'),
			]).then(([render, compute]) => {
				if (render !== undefined) gpuTimes.push(render + (compute ?? 0));
			});
		},
		options.warmupSeconds,
		options.measureSeconds,
	);
	await gpu.resolveTimestampsAsync('render');
	const medianOf = (values: number[]) => (values.length === 0 ? null : median(values));
	const desert: DesertFigures = {
		engine: meshlets ? 'three.js r187 meshlets' : 'three.js r187',
		view,
		shadows: shadows === null ? null : cascaded ? shadows : 1,
		drawn: { width: canvas.width, height: canvas.height },
		intervalMs: timings.intervalMs.median,
		gpuMs: medianOf(gpuTimes),
		triangles: medianOf(triangles),
		drawCalls: meshlets ? null : gpu.info.render.drawCalls,
		firstFrameMs,
		settings: {
			pipeline: meshlets ? 'meshlets' : 'standard',
			...(meshlets && THREE_MESHLETS),
			...(shadows !== null && {
				shadowMap: cascaded
					? `${shadows} cascades of ${DESERT_SHADOWS.mapSize}`
					: DESERT_SHADOWS.threeMapSize,
			}),
			meshletsDrawn: pipeline?.info.clusters ?? null,
		},
	};
	return { scene: 'desert', renderer, n: DESERT_COUNT, ...timings, desert };
});
