// Runs a three.js twin of a benchmark scene. It builds what every scene shares (the renderer, the
// lights, the background and the camera), then does one of two things. With `?hold`, it renders one
// frame at the hold time into an offscreen target and publishes the pixels. Otherwise it runs a
// timed benchmark and publishes the frame timings. `?renderer=webgl` uses WebGLRenderer from
// `three`; `?renderer=webgpu` uses WebGPURenderer from `three/webgpu`, on WebGPU only. The page
// loads only the three.js build that it uses.
import type * as ThreeModule from 'three';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	AMBIENT,
	BACKGROUND,
	CAMERA,
	CANVAS,
	HOLD_TIME,
	MEASURE_SECONDS,
	type OutArray,
	PARITY_CANVAS,
	SUN,
	WARMUP_SECONDS,
} from '../../scenes/spec';
import { measureFrames } from '../lib/measure';
import { type RunOptions, readChoice, readRunOptions } from '../lib/options';
import { packRows, rowStrideOf } from '../lib/pixels';

/** The three.js classes that the scenes use. The `three` and `three/webgpu` builds both export them. */
export type Three = Pick<
	typeof ThreeModule,
	| 'AmbientLight'
	| 'BoxGeometry'
	| 'Color'
	| 'DirectionalLight'
	| 'DynamicDrawUsage'
	| 'InstancedMesh'
	| 'Matrix4'
	| 'Mesh'
	| 'MeshLambertMaterial'
	| 'PerspectiveCamera'
	| 'Quaternion'
	| 'Scene'
	| 'Vector3'
>;

export interface SceneSetup {
	/** The object count that the report gives. */
	n: number;
	/** Moves the scene to time t, in seconds. It runs every frame, so it must allocate nothing. */
	update?(t: number): void;
	/** Writes the camera position and target at time t. */
	camera(t: number, outPosition: OutArray, outTarget: OutArray): void;
}

/** Adds one scene's objects to `scene` and says how they move. */
export type BuildScene = (
	three: Three,
	scene: ThreeModule.Scene,
	options: RunOptions,
) => SceneSetup;

const RENDERERS = ['webgl', 'webgpu'] as const;

/** Samples per pixel in the hold frame's target: the count that `antialias: true` gives a canvas. */
const MSAA_SAMPLES = 4;
/** The sun's distance from the origin. Its light travels from there toward the origin. */
const SUN_DISTANCE = 100;

/** What the harness needs from either three.js renderer. */
interface Renderer {
	readonly domElement: HTMLCanvasElement;
	setPixelRatio(ratio: number): void;
	setSize(width: number, height: number): void;
	render(scene: ThreeModule.Object3D, camera: ThreeModule.Camera): void;
	compileAsync(scene: ThreeModule.Object3D, camera: ThreeModule.Camera): Promise<unknown>;
}

interface Engine {
	three: Three;
	renderer: Renderer;
	/**
	 * Calls `draw` with an offscreen target bound, then reads the target as RGBA8 pixels, top row
	 * first. The target stores 8-bit sRGB, so the GPU encodes the renderer's linear output the way
	 * the canvas shows it, and it has as many samples as the canvas.
	 */
	readFrame(width: number, height: number, draw: () => void): Promise<Uint8Array>;
}

async function startWebGL(): Promise<Engine> {
	const three = await import('three');
	const renderer = new three.WebGLRenderer({ antialias: true });
	return {
		three,
		renderer,
		async readFrame(width, height, draw) {
			const target = new three.WebGLRenderTarget(width, height, {
				samples: MSAA_SAMPLES,
				colorSpace: three.SRGBColorSpace,
			});
			renderer.setRenderTarget(target);
			draw();
			renderer.setRenderTarget(null);
			const bottomFirst = new Uint8Array(width * height * 4);
			renderer.readRenderTargetPixels(target, 0, 0, width, height, bottomFirst);
			target.dispose();
			return packRows(bottomFirst, width, height, width * 4, true);
		},
	};
}

async function startWebGPU(): Promise<Engine> {
	if (!('gpu' in navigator)) {
		throw new Error('This browser has no WebGPU. Use a browser with WebGPU, or ?renderer=webgl.');
	}
	const three = await import('three/webgpu');
	const renderer = new three.WebGPURenderer({ antialias: true });
	await renderer.init();
	// WebGPURenderer switches to its WebGL 2 backend when WebGPU fails to start. A WebGPU run must
	// never measure WebGL by mistake, so that counts as an error.
	if (!('isWebGPUBackend' in renderer.backend)) {
		throw new Error(
			'three.js could not start WebGPU and switched to WebGL 2. See the console for the cause, or use ?renderer=webgl.',
		);
	}
	return {
		three,
		renderer,
		async readFrame(width, height, draw) {
			const target = new three.RenderTarget(width, height, {
				samples: MSAA_SAMPLES,
				colorSpace: three.SRGBColorSpace,
			});
			renderer.setRenderTarget(target);
			draw();
			renderer.setRenderTarget(null);
			const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
			target.dispose();
			const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			return packRows(bytes, width, height, rowStrideOf(bytes.length, width, height), false);
		},
	};
}

/**
 * Builds the scene with `build` and runs the mode that the page address asks for. The result goes
 * to the page and to the dev server's collector: as the `hold` report with `?hold`, else as the
 * `bench` report. A failure publishes its message as the result's error.
 */
export function runThreePage(sceneName: string, build: BuildScene): void {
	const params = new URLSearchParams(location.search);
	run(params.has('hold') ? 'hold' : 'bench', async () => {
		const options = readRunOptions(params);
		const rendererName = readChoice(params, 'renderer', RENDERERS);
		const { three, renderer, readFrame } =
			rendererName === 'webgpu' ? await startWebGPU() : await startWebGL();
		renderer.setPixelRatio(CANVAS.pixelRatio);
		renderer.setSize(CANVAS.width, CANVAS.height);

		const scene = new three.Scene();
		scene.background = new three.Color(BACKGROUND);
		const sun = new three.DirectionalLight(SUN.color, SUN.intensity);
		sun.position.set(...SUN.direction).multiplyScalar(-SUN_DISTANCE);
		scene.add(sun, new three.AmbientLight(AMBIENT.color, AMBIENT.intensity));
		const camera = new three.PerspectiveCamera(
			CAMERA.fov,
			CANVAS.width / CANVAS.height,
			CAMERA.near,
			CAMERA.far,
		);

		const setup = build(three, scene, options);
		const cameraPosition = new Float64Array(3);
		const cameraTarget = new Float64Array(3);
		const pose = (t: number): void => {
			setup.update?.(t);
			setup.camera(t, cameraPosition, cameraTarget);
			camera.position.fromArray(cameraPosition);
			camera.lookAt(cameraTarget[0] ?? 0, cameraTarget[1] ?? 0, cameraTarget[2] ?? 0);
		};
		const frame = (t: number): void => {
			pose(t);
			renderer.render(scene, camera);
		};
		const report = { scene: sceneName, renderer: rendererName, n: setup.n };

		if (options.hold) {
			const { width, height } = PARITY_CANVAS;
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
			const pixels = await readFrame(width, height, () => frame(HOLD_TIME));
			return { ...report, width, height, pixels: toBase64(pixels) };
		}

		document.body.prepend(renderer.domElement);
		pose(0);
		await renderer.compileAsync(scene, camera);
		renderer.render(scene, camera);
		const timings = await measureFrames(
			frame,
			options.seconds ?? WARMUP_SECONDS,
			options.seconds ?? MEASURE_SECONDS,
		);
		return { ...report, ...timings };
	});
}
