// Runs a three.js twin of a benchmark scene. It builds what every scene shares (the renderer, the
// sun and the ambient light, the background and the camera), then does one of two things. With
// `?hold`, it renders one frame at the hold time into an offscreen target and publishes the pixels.
// Otherwise it runs a timed benchmark and publishes the frame timings. `?renderer=webgl` uses
// WebGLRenderer from `three`; `?renderer=webgpu` uses WebGPURenderer from `three/webgpu`, on WebGPU
// only. The page loads only the three.js build that it uses.
import type * as ThreeModule from 'three';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	BACKGROUND,
	CAMERA,
	CANVAS,
	MEASURE_SECONDS,
	type OutArray,
	PARITY_CANVAS,
	type SceneLights,
	SHADOWS,
	VIEW_LIGHTS,
	WARMUP_SECONDS,
} from '../../scenes/spec';
import { fillWindow, fitToWindow, showPageName } from '../lib/fit';
import { measureFrames } from '../lib/measure';
import { pageReport, type RunOptions, readChoice, readRunOptions } from '../lib/options';
import { packRows, rowStrideOf } from '../lib/pixels';
import { fixedTrace } from '../lib/trace';

/** The three.js classes that the scenes use. The `three` and `three/webgpu` builds both export them. */
export type Three = Pick<
	typeof ThreeModule,
	| 'AmbientLight'
	| 'AnimationClip'
	| 'AnimationMixer'
	| 'BatchedMesh'
	| 'Bone'
	| 'Box3'
	| 'BoxGeometry'
	| 'BufferAttribute'
	| 'BufferGeometry'
	| 'CapsuleGeometry'
	| 'CircleGeometry'
	| 'Color'
	| 'ConeGeometry'
	| 'CylinderGeometry'
	| 'DataTexture'
	| 'DirectionalLight'
	| 'DoubleSide'
	| 'DynamicDrawUsage'
	| 'Float32BufferAttribute'
	| 'Fog'
	| 'FogExp2'
	| 'HemisphereLight'
	| 'InstancedMesh'
	| 'InterpolateDiscrete'
	| 'LinearFilter'
	| 'LinearMipmapLinearFilter'
	| 'Matrix4'
	| 'Mesh'
	| 'MeshBasicMaterial'
	| 'MeshStandardMaterial'
	| 'NoColorSpace'
	| 'OrthographicCamera'
	| 'PerspectiveCamera'
	| 'PlaneGeometry'
	| 'PointLight'
	| 'Quaternion'
	| 'QuaternionKeyframeTrack'
	| 'RepeatWrapping'
	| 'RingGeometry'
	| 'Scene'
	| 'Skeleton'
	| 'SkinnedMesh'
	| 'SphereGeometry'
	| 'SpotLight'
	| 'Sprite'
	| 'SpriteMaterial'
	| 'SRGBColorSpace'
	| 'TextureLoader'
	| 'TorusGeometry'
	| 'Uint16BufferAttribute'
	| 'Vector3'
>;

/** How a twin lights and draws its scene, where it differs from what every scene shares. */
export interface ThreePageOptions {
	/** The sun and the ambient light: the ones that every scene shares, unless it names others. */
	lights?: SceneLights;
	/** The background color. */
	background?: string;
	/**
	 * Draw as a full-screen app on a phone does: the canvas fills the window, at the device's pixel
	 * ratio up to the cap that the scene's setup gives. Hold mode keeps the parity canvas.
	 */
	fillWindow?: boolean;
	/** Record the frames drawn in each measured second, as the phone scene's trace. */
	trace?: boolean;
	/**
	 * Shade point lights through three.js's clustered lighting on WebGPURenderer. Its
	 * `ClusteredLighting` addon (Forward+) assigns each point light to the clusters of the view that
	 * its range reaches, in a compute pass, so each fragment shades only the lights of its cluster.
	 * WebGLRenderer has no such lighting: it shades every point light in every fragment.
	 */
	clusteredLighting?: boolean;
}

export interface SceneSetup {
	/** The object count that the report gives. */
	n: number;
	/** Moves the scene to time t, in seconds. It runs every frame, so it must allocate nothing. */
	update?(t: number): void;
	/** Writes the camera position and target at time t. */
	camera(t: number, outPosition: OutArray, outTarget: OutArray): void;
	/** Runs every frame after the camera moves, before the frame draws. It must allocate nothing. */
	afterCamera?(): void;
	/** Runs after the camera's aspect changes, as when the hold frame takes the parity size. */
	onAspect?(): void;
	/** With `fillWindow`: the highest pixel ratio to draw at. The default is no cap. */
	maxPixelRatio?: number;
	/** Figures that the page's report adds, such as the settings the scene chose. */
	report?: Record<string, unknown>;
}

/** What a scene's build gets besides the classes of three.js and the scene. */
export interface BuildContext {
	/** The renderer that `?renderer=` names. */
	rendererName: (typeof RENDERERS)[number];
	renderer: Renderer;
	camera: ThreeModule.PerspectiveCamera;
	/** The sun that the harness added to the scene. */
	sun: ThreeModule.DirectionalLight;
	/** The page's address switches. */
	params: URLSearchParams;
}

/** Adds one scene's objects to `scene` and says how they move. */
export type BuildScene = (
	three: Three,
	scene: ThreeModule.Scene,
	options: RunOptions,
	context: BuildContext,
) => SceneSetup | Promise<SceneSetup>;

/** three.js's two renderers, as the `?renderer=` switch names them. */
export const RENDERERS = ['webgl', 'webgpu'] as const;

/** Samples per pixel in the hold frame's target: the count that `antialias: true` gives a canvas. */
const MSAA_SAMPLES = 4;
/** The sun's distance from the origin. Its light travels from there toward the origin. */
const SUN_DISTANCE = 100;

/** What the harness needs from either three.js renderer. */
export interface Renderer {
	readonly domElement: HTMLCanvasElement;
	/** Shadow maps, which scenes with shadows turn on. */
	readonly shadowMap: { enabled: boolean };
	setPixelRatio(ratio: number): void;
	setSize(width: number, height: number, updateStyle?: boolean): void;
	render(scene: ThreeModule.Object3D, camera: ThreeModule.Camera): void;
	compileAsync(scene: ThreeModule.Object3D, camera: ThreeModule.Camera): Promise<unknown>;
	/** Calls `frame` with the time in milliseconds once per display frame, until the page closes. */
	setAnimationLoop(frame: ((ms: number) => void) | null): unknown;
}

/** A three.js renderer that has started, with the classes of its build. */
export interface ThreeEngine {
	three: Three;
	renderer: Renderer;
	/**
	 * Calls `draw` with an offscreen target bound, then reads the target as RGBA8 pixels, top row
	 * first. The target stores 8-bit sRGB, so the GPU encodes the renderer's linear output the way
	 * the canvas shows it, and it has as many samples as the canvas.
	 */
	readFrame(width: number, height: number, draw: () => void): Promise<Uint8Array>;
	/** Throws when a shader of the frames drawn so far failed to build, so the scene drew nothing. */
	checkShaders(): void;
}

async function startWebGL(): Promise<ThreeEngine> {
	const three = await import('three');
	// Both engines ask for the faster GPU, so a device with two draws both on the same one.
	const renderer = new three.WebGLRenderer({
		antialias: true,
		powerPreference: 'high-performance',
	});
	// A shader past the GPU's limits, such as one with more uniforms than the GPU holds, fails to
	// build, and its objects draw nothing. The page then fails with the GPU's reason.
	let shaderFailure: string | undefined;
	renderer.debug.onShaderError = (gl, program) => {
		shaderFailure ??= gl.getProgramInfoLog(program)?.trim() || 'the GPU gave no reason';
	};
	return {
		three,
		renderer,
		checkShaders() {
			if (shaderFailure !== undefined)
				throw new Error(
					`three.js's WebGLRenderer could not build a shader of this scene on this GPU: ${shaderFailure}`,
				);
		},
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

async function startWebGPU({ clusteredLighting }: ThreePageOptions): Promise<ThreeEngine> {
	if (!('gpu' in navigator)) {
		throw new Error('This browser has no WebGPU. Use a browser with WebGPU, or ?renderer=webgl.');
	}
	const three = await import('three/webgpu');
	const renderer = new three.WebGPURenderer({
		antialias: true,
		powerPreference: 'high-performance',
	});
	await renderer.init();
	// WebGPURenderer switches to its WebGL 2 backend when WebGPU fails to start. A WebGPU run must
	// never measure WebGL by mistake, so that counts as an error.
	if (!('isWebGPUBackend' in renderer.backend)) {
		throw new Error(
			'three.js could not start WebGPU and switched to WebGL 2. See the console for the cause, or use ?renderer=webgl.',
		);
	}
	if (clusteredLighting) {
		const { ClusteredLighting } = await import('three/addons/lighting/ClusteredLighting.js');
		renderer.lighting = new ClusteredLighting();
	}
	return {
		three,
		renderer,
		// WebGPU reports a shader that fails as a console error, which the page tests catch.
		checkShaders() {},
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
 * Starts the three.js renderer that `?renderer=` names, loading only the build that it uses, and
 * any lighting addon that `options` asks for.
 */
export function startThree(
	renderer: (typeof RENDERERS)[number],
	options: ThreePageOptions = {},
): Promise<ThreeEngine> {
	return renderer === 'webgpu' ? startWebGPU(options) : startWebGL();
}

/**
 * Gives a scene the background, and a sun and an ambient light: the shared ones by default. Returns
 * the sun.
 */
export function lightScene(
	three: Three,
	scene: ThreeModule.Scene,
	{ sun, ambient }: SceneLights = VIEW_LIGHTS,
	background: string = BACKGROUND,
): ThreeModule.DirectionalLight {
	scene.background = new three.Color(background);
	const light = new three.DirectionalLight(sun.color, sun.intensity);
	light.position.set(...sun.direction).multiplyScalar(-SUN_DISTANCE);
	scene.add(light, new three.AmbientLight(ambient.color, ambient.intensity));
	return light;
}

/**
 * Turns on the renderer's shadows, and has the sun cast them into one map of the benchmark scenes'
 * shadow size, in a box around the origin that holds every scene.
 */
function castSunShadows(renderer: Renderer, sun: ThreeModule.DirectionalLight): void {
	renderer.shadowMap.enabled = true;
	sun.castShadow = true;
	const { mapSize, threeHalfSize: half } = SHADOWS;
	sun.shadow.mapSize.set(mapSize, mapSize);
	const box = sun.shadow.camera;
	[box.left, box.right, box.top, box.bottom] = [-half, half, half, -half];
	[box.near, box.far] = [0, 2 * sun.position.length()];
	box.updateProjectionMatrix();
}

/**
 * Builds the scene with `build` and runs the mode that the page address asks for. The result goes
 * to the page and to the dev server's collector: as the `hold` report with `?hold`, else as the
 * `bench` report. A failure publishes its message as the result's error.
 */
export function runThreePage(
	sceneName: string,
	build: BuildScene,
	pageOptions: ThreePageOptions = {},
): void {
	const params = new URLSearchParams(location.search);
	showPageName();
	run(pageReport(params), async () => {
		const options = readRunOptions(params);
		const rendererName = readChoice(params, 'renderer', RENDERERS);
		const { three, renderer, readFrame, checkShaders } = await startThree(
			rendererName,
			pageOptions,
		);
		renderer.setPixelRatio(CANVAS.pixelRatio);
		renderer.setSize(CANVAS.width, CANVAS.height);

		const held = options.hold !== null;
		const filled = pageOptions.fillWindow === true && !held;
		if (filled) {
			document.body.append(renderer.domElement);
			fillWindow(renderer.domElement);
		}
		const size = () =>
			filled
				? { width: renderer.domElement.clientWidth, height: renderer.domElement.clientHeight }
				: CANVAS;
		const scene = new three.Scene();
		const sun = lightScene(three, scene, pageOptions.lights, pageOptions.background);
		if (options.shadows !== null) castSunShadows(renderer, sun);
		const camera = new three.PerspectiveCamera(
			CAMERA.fov,
			size().width / size().height,
			CAMERA.near,
			CAMERA.far,
		);

		const setup = await build(three, scene, options, {
			rendererName,
			renderer,
			camera,
			sun,
			params,
		});
		if (filled) {
			// The canvas's drawing buffer follows the window, as the engine's does.
			const fit = () => {
				const { width, height } = size();
				renderer.setPixelRatio(Math.min(devicePixelRatio, setup.maxPixelRatio ?? Infinity));
				renderer.setSize(width, height, false);
				camera.aspect = width / height;
				camera.updateProjectionMatrix();
				setup.onAspect?.();
			};
			fit();
			addEventListener('resize', fit);
		}
		const cameraPosition = new Float64Array(3);
		const cameraTarget = new Float64Array(3);
		const pose = (t: number): void => {
			setup.update?.(t);
			setup.camera(t, cameraPosition, cameraTarget);
			camera.position.fromArray(cameraPosition);
			camera.lookAt(cameraTarget[0] ?? 0, cameraTarget[1] ?? 0, cameraTarget[2] ?? 0);
			setup.afterCamera?.();
		};
		/** Draws the scene at time t, and returns the milliseconds its update took. */
		const frame = (t: number): number => {
			const start = performance.now();
			pose(t);
			const updated = performance.now();
			renderer.render(scene, camera);
			return updated - start;
		};
		const report = {
			scene: sceneName,
			renderer: rendererName,
			n: setup.n,
			...setup.report,
			...(filled && {
				canvas: {
					...size(),
					pixelRatio: Math.min(devicePixelRatio, setup.maxPixelRatio ?? Infinity),
				},
			}),
		};

		const hold = options.hold;
		if (hold !== null) {
			const { width, height } = PARITY_CANVAS;
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
			setup.onAspect?.();
			// Clustered lighting sizes its grid of clusters by the canvas, even when a target is bound,
			// so the canvas takes the size of the frame.
			renderer.setSize(width, height);
			const pixels = await readFrame(width, height, () => frame(hold));
			checkShaders();
			return { ...report, width, height, pixels: toBase64(pixels) };
		}

		if (!filled) {
			document.body.append(renderer.domElement);
			fitToWindow(renderer.domElement, CANVAS.width, CANVAS.height);
		}
		pose(0);
		await renderer.compileAsync(scene, camera);
		renderer.render(scene, camera);
		checkShaders();
		if (options.demo) {
			renderer.setAnimationLoop((ms) => frame(ms / 1000));
			return report;
		}
		const timings = await measureFrames(
			frame,
			options.seconds ?? WARMUP_SECONDS,
			options.seconds ?? MEASURE_SECONDS,
		);
		return {
			...report,
			...timings,
			...(pageOptions.trace && { trace: fixedTrace(timings.perSecond) }),
		};
	});
}
