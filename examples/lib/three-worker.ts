// The three.js half of every comparison, as it runs in its one worker with an OffscreenCanvas. A
// comparison's three.ts builds its scene and calls `runThreeWorker`, which does the rest:
//
// - It starts the renderer that the page names: WebGLRenderer from `three`, or WebGPURenderer from
//   `three/webgpu` on WebGPU. Both ask for the high-performance GPU and 4x MSAA.
// - It draws each effect with three.js's own technique for the look that the scene describes. On
//   WebGLRenderer, EffectComposer runs RenderPass, GTAOPass, UnrealBloomPass, OutputPass (the AgX
//   curve and sRGB) and LUTPass. On WebGPURenderer, the render pipeline runs the same as nodes:
//   the GTAO node, the bloom node, the output transform and the 3D LUT node. The environment is
//   three.js's RoomEnvironment through PMREMGenerator. Height fog has no class in three.js, so the
//   worker gives the scene the formula of null3D's fog: GLSL in place of FogExp2's chunks on
//   WebGLRenderer, and a fog node on WebGPURenderer.
// - Each frame runs the simulation steps that fell due, as null3D's fixed steps do, poses the
//   scene and draws it, and records the frame's interval and CPU time in rings that allocate
//   nothing. The page asks for measurements and, while its stats panel is open, for the figures
//   that the panel shows, which three.js's `renderer.info` counts.

import type * as ThreeModule from 'three';
import { FixedClock, type GradeTable, type Hex } from './compare-scene';
import type { FromThree, ThreeFigures, ThreeStart, ToThree } from './three-protocol';

/** The three.js version that the comparisons pin. */
export const THREE_VERSION = '0.186.1';

/** The build of three.js that a scene's objects come from: `three` or `three/webgpu`. */
export type Three = typeof ThreeModule;

/** The look that the worker draws around a scene, from the scene's shared description. */
export interface ThreeLook {
	exposure: number;
	environmentIntensity: number;
	fog: { color: Hex; density: number; height: number; heightFalloff: number };
	/** UnrealBloomPass's settings. */
	bloom: { threshold: number; strength: number; radius: number };
	/** Ambient occlusion's search radius in meters, and its targets' share of the render size. */
	ao: { radius: number; scale: number };
	grade: GradeTable;
}

/** A built scene, ready to step and draw. */
export interface ThreeSceneBuild {
	scene: ThreeModule.Scene;
	camera: ThreeModule.PerspectiveCamera;
	look: ThreeLook;
	/** Shows `count` of the scene, in the scene's own unit. */
	setCount(count: number): void;
	/** Runs one simulation step. */
	step(): void;
	/** Writes every moving object and the camera for simulation time `seconds`. Allocates nothing. */
	pose(seconds: number): void;
}

/** What a scene's build gets. */
export interface ThreeBuildContext {
	three: Three;
	options: ThreeStart;
	/** The texture anisotropy that the renderer offers, at most 8, as null3D's preset caps it. */
	anisotropy: number;
}

export type ThreeBuilder = (
	context: ThreeBuildContext,
) => ThreeSceneBuild | Promise<ThreeSceneBuild>;

/** Samples per pixel: what `antialias: true` gives a canvas, and what null3D's MSAA draws. */
const MSAA_SAMPLES = 4;
/**
 * The bloom node spreads a third of UnrealBloomPass's light at the same strength, with the same
 * spread (the port skill's bloom mapping), so it takes this many times the strength.
 */
const BLOOM_NODE_STRENGTH = 3;
/** Frames that the rings keep: over 30 seconds at 240 frames per second. */
const RING = 8192;
/** How often the page gets the frame rate, and the panel's figures while it is open. */
const REPORT_MS = 250;
/** The window of frames that each report means over. */
const WINDOW_MS = 500;
/** The GPU timer times one frame in this many, as null3D's does. */
const GPU_EVERY = 11;

type AnyRenderer = ThreeModule.WebGLRenderer & {
	init?: () => Promise<unknown>;
	backend?: { isWebGPUBackend?: boolean };
	info: ThreeModule.WebGLInfo & {
		render: { calls?: number; drawCalls?: number; triangles: number };
		update: (...args: unknown[]) => void;
	};
	resolveTimestampsAsync?: (type?: string) => Promise<number | undefined>;
	readRenderTargetPixelsAsync?: (
		target: unknown,
		x: number,
		y: number,
		width: number,
		height: number,
	) => Promise<ArrayBufferView>;
};

/** Times the GPU's work of the frames that it samples, around each frame's render calls. */
interface GpuTimer {
	before(): void;
	after(): void;
}

/** Draws one frame with the effects, and follows the canvas's size. */
interface Drawer {
	render(): void;
	setSize(width: number, height: number, pixelRatio: number): void;
}

/** Frame records in rings: time, interval, CPU time, the scene's code and the render calls. */
class FrameRings {
	readonly time = new Float64Array(RING);
	readonly interval = new Float64Array(RING);
	readonly busy = new Float64Array(RING);
	readonly code = new Float64Array(RING);
	readonly render = new Float64Array(RING);
	readonly gpuTime = new Float64Array(RING);
	readonly gpu = new Float64Array(RING);
	next = 0;
	size = 0;
	gpuNext = 0;
	gpuSize = 0;

	add(time: number, interval: number, busy: number, code: number, render: number): void {
		const i = this.next;
		this.time[i] = time;
		this.interval[i] = interval;
		this.busy[i] = busy;
		this.code[i] = code;
		this.render[i] = render;
		this.next = (i + 1) % RING;
		if (this.size < RING) this.size++;
	}

	addGpu(time: number, ms: number): void {
		this.gpuTime[this.gpuNext] = time;
		this.gpu[this.gpuNext] = ms;
		this.gpuNext = (this.gpuNext + 1) % RING;
		if (this.gpuSize < RING) this.gpuSize++;
	}

	/** Means of the frames since `since`: frames, frames per second, and the CPU times. */
	window(since: number, out: Float64Array): void {
		let frames = 0;
		let interval = 0;
		let busy = 0;
		let code = 0;
		let render = 0;
		for (let k = 1; k <= this.size; k++) {
			const i = (this.next - k + RING) % RING;
			if ((this.time[i] as number) < since) break;
			frames++;
			interval += this.interval[i] as number;
			busy += this.busy[i] as number;
			code += this.code[i] as number;
			render += this.render[i] as number;
		}
		let gpu = 0;
		let gpuFrames = 0;
		for (let k = 1; k <= this.gpuSize; k++) {
			const i = (this.gpuNext - k + RING) % RING;
			if ((this.gpuTime[i] as number) < since - WINDOW_MS) break;
			gpu += this.gpu[i] as number;
			gpuFrames++;
		}
		out[0] = frames;
		out[1] = interval > 0 ? (frames * 1000) / interval : 0;
		out[2] = frames > 0 ? busy / frames : 0;
		out[3] = frames > 0 ? code / frames : 0;
		out[4] = frames > 0 ? render / frames : 0;
		out[5] = gpuFrames > 0 ? gpu / gpuFrames : -1;
	}
}

class ThreeRuntime {
	private renderer: AnyRenderer | null = null;
	private build: ThreeSceneBuild | null = null;
	private drawer: Drawer | null = null;
	private readonly clock = new FixedClock();
	private readonly rings = new FrameRings();
	private readonly means = new Float64Array(6);
	private lastTime = -1;
	private frame = 0;
	private sampling = false;
	private reportTimer: ReturnType<typeof setInterval> | null = null;
	/** Instances drawn in the frame, from three.js's own count of each draw. */
	private objects = 0;
	private gpuTimer: GpuTimer | null = null;

	constructor(
		private readonly canvas: OffscreenCanvas,
		private readonly options: ThreeStart,
		private readonly post: (message: FromThree, transfer?: Transferable[]) => void,
		private readonly builder: ThreeBuilder,
	) {}

	async start(): Promise<void> {
		const { options } = this;
		const { three, renderer, name } = await this.makeRenderer();
		this.renderer = renderer;
		renderer.setPixelRatio(options.pixelRatio);
		renderer.setSize(options.width, options.height, false);
		renderer.outputColorSpace = three.SRGBColorSpace;
		renderer.shadowMap.enabled = options.effects.shadows;
		renderer.shadowMap.type = three.PCFShadowMap;
		const anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() ?? 8);
		const build = await this.builder({ three, options, anisotropy });
		this.build = build;
		const { look, scene, camera } = build;
		renderer.toneMapping = three.AgXToneMapping;
		renderer.toneMappingExposure = look.exposure;
		camera.aspect = options.width / options.height;
		camera.updateProjectionMatrix();
		await this.addEnvironment(three, scene, look);
		if (options.effects.fog) await this.addFog(three, scene, look);
		// Post-processing draws count too, so the counts reset once a frame, not once a draw.
		renderer.info.autoReset = false;
		const update = renderer.info.update.bind(renderer.info);
		renderer.info.update = (...args: unknown[]) => {
			const instances = args[args.length - 1];
			this.objects += typeof instances === 'number' && instances > 0 ? instances : 1;
			update(...args);
		};
		this.drawer = await makeDrawer(three, renderer, build, options);
		const skipped = this.clock.skipTo(options.hold ?? 0);
		for (let i = 0; i < skipped; i++) build.step();
		build.pose(this.clock.time);
		// Build every GPU program before the first frame, so none builds during a measurement.
		await (
			renderer as unknown as { compileAsync(s: unknown, c: unknown): Promise<void> }
		).compileAsync(scene, camera);
		this.gpuTimer = options.gpuTimer ? this.makeGpuTimer(renderer) : null;
		this.post({
			type: 'started',
			renderer: name,
			version: `three.js ${THREE_VERSION}`,
			gpuTimer: this.gpuTimer !== null,
		});
		if (options.hold !== null) {
			await this.hold(three, renderer);
			return;
		}
		this.drawer.render();
		this.reportTimer = setInterval(() => this.report(), REPORT_MS);
		renderer.setAnimationLoop(this.onFrame);
	}

	private async makeRenderer(): Promise<{ three: Three; renderer: AnyRenderer; name: string }> {
		const { canvas, options } = this;
		if (options.renderer === 'webgpu') {
			const webgpu = await import('three/webgpu');
			const renderer = new webgpu.WebGPURenderer({
				canvas: canvas as unknown as HTMLCanvasElement,
				antialias: true,
				powerPreference: 'high-performance',
				trackTimestamp: options.gpuTimer,
			}) as unknown as AnyRenderer;
			await renderer.init?.();
			// WebGPURenderer falls back to WebGL 2 when WebGPU fails to start. A WebGPU run must never
			// measure WebGL by mistake, so that counts as an error.
			if (!renderer.backend?.isWebGPUBackend)
				throw new Error('three.js could not start WebGPU here. Add ?gpu=webgl2 to the address.');
			return { three: webgpu as unknown as Three, renderer, name: 'WebGPURenderer' };
		}
		const three = await import('three');
		const renderer = new three.WebGLRenderer({
			canvas: canvas as unknown as HTMLCanvasElement,
			antialias: true,
			powerPreference: 'high-performance',
		}) as AnyRenderer;
		return { three, renderer, name: 'WebGLRenderer' };
	}

	/** The room environment, prefiltered by the PMREMGenerator of the renderer's build. */
	private async addEnvironment(three: Three, scene: ThreeModule.Scene, look: ThreeLook) {
		const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
		const pmrem = new three.PMREMGenerator(this.renderer as ThreeModule.WebGLRenderer);
		scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
		scene.environmentIntensity = look.environmentIntensity;
		pmrem.dispose();
	}

	/**
	 * Height fog with null3D's formula: exponential with the distance, at a density that thins by
	 * the fog's falloff with height. The factor sums the density along the line of sight, so a view
	 * down into the haze sees more of it than a view across.
	 */
	private async addFog(three: Three, scene: ThreeModule.Scene, look: ThreeLook) {
		const { color, density, height, heightFalloff } = look.fog;
		if (this.options.renderer === 'webgpu') {
			const tsl = await import('three/tsl');
			const ray = tsl.positionWorld.sub(tsl.cameraPosition);
			const climb = ray.y.mul(heightFalloff);
			const ratio = tsl.select(
				climb.abs().lessThan(0.01),
				climb.mul(climb.div(6).sub(0.5)).add(1),
				tsl
					.float(1)
					.sub(tsl.exp(tsl.min(climb.negate(), 40)))
					.div(climb),
			);
			const atCamera = tsl.exp(tsl.cameraPosition.y.sub(height).mul(-heightFalloff));
			const path = ray.length().mul(atCamera).mul(ratio);
			const factor = tsl.float(1).sub(tsl.exp(path.mul(-density)));
			(scene as unknown as { fogNode: unknown }).fogNode = tsl.fog(tsl.color(color), factor);
			return;
		}
		const chunks = three.ShaderChunk as unknown as Record<string, string>;
		chunks.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying vec3 vFogWorld;\n#endif';
		chunks.fog_vertex = `#ifdef USE_FOG
	vec4 fogWorld = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		fogWorld = batchingMatrix * fogWorld;
	#endif
	#ifdef USE_INSTANCING
		fogWorld = instanceMatrix * fogWorld;
	#endif
	vFogWorld = ( modelMatrix * fogWorld ).xyz;
#endif`;
		const f = heightFalloff.toFixed(6);
		chunks.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying vec3 vFogWorld;
	uniform float fogDensity;
#endif`;
		chunks.fog_fragment = `#ifdef USE_FOG
	vec3 fogRay = vFogWorld - cameraPosition;
	float fogClimb = ${f} * fogRay.y;
	float fogRatio = abs( fogClimb ) < 0.01 ? 1.0 + fogClimb * ( fogClimb / 6.0 - 0.5 ) : ( 1.0 - exp( min( - fogClimb, 40.0 ) ) ) / fogClimb;
	float fogPath = length( fogRay ) * exp( - ${f} * ( cameraPosition.y - ${height.toFixed(6)} ) ) * fogRatio;
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, 1.0 - exp( - fogDensity * fogPath ) );
#endif`;
		scene.fog = new three.FogExp2(color, density);
	}

	private readonly onFrame = (time: number): void => {
		const renderer = this.renderer;
		const build = this.build;
		const drawer = this.drawer;
		if (!renderer || !build || !drawer) return;
		const start = performance.now();
		const interval = this.lastTime < 0 ? 0 : time - this.lastTime;
		this.lastTime = time;
		const steps = this.clock.advance(interval / 1000);
		for (let i = 0; i < steps; i++) build.step();
		build.pose(this.clock.time);
		const posed = performance.now();
		renderer.info.reset();
		this.objects = 0;
		this.frame++;
		this.gpuTimer?.before();
		drawer.render();
		this.gpuTimer?.after();
		const end = performance.now();
		if (interval > 0) this.rings.add(time, interval, end - start, posed - start, end - posed);
	};

	/**
	 * A GPU timer that times the frames that the panel samples: WebGL2's timer queries around one
	 * frame in eleven, or WebGPURenderer's own timestamps. Null where the renderer has neither.
	 */
	private makeGpuTimer(renderer: AnyRenderer): GpuTimer | null {
		if (this.options.renderer === 'webgpu') {
			if (!renderer.resolveTimestampsAsync) return null;
			let asking = false;
			let frames = 0;
			const after = () => {
				frames++;
				if (asking) return;
				asking = true;
				const counted = frames;
				frames = 0;
				renderer
					.resolveTimestampsAsync?.('render')
					.then((ms) => {
						if (this.sampling && typeof ms === 'number' && ms > 0)
							this.rings.addGpu(performance.now(), ms / counted);
					})
					.catch(() => {})
					.finally(() => {
						asking = false;
					});
			};
			return { before: () => {}, after };
		}
		const gl = renderer.getContext() as WebGL2RenderingContext;
		const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
			TIME_ELAPSED_EXT: number;
			GPU_DISJOINT_EXT: number;
		} | null;
		if (!timer) return null;
		let query: WebGLQuery | null = null;
		let running = false;
		const before = () => {
			if (query) {
				if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
				if (!gl.getParameter(timer.GPU_DISJOINT_EXT))
					this.rings.addGpu(performance.now(), gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
				gl.deleteQuery(query);
				query = null;
			}
			if (!this.sampling || this.frame % GPU_EVERY !== 0) return;
			query = gl.createQuery();
			if (!query) return;
			gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
			running = true;
		};
		const after = () => {
			if (!running) return;
			gl.endQuery(timer.TIME_ELAPSED_EXT);
			running = false;
		};
		return { before, after };
	}

	/** Draws the held frame and reads it back as RGBA8 rows, top row first. */
	private async hold(three: Three, renderer: AnyRenderer): Promise<void> {
		const { width, height } = this.options;
		const drawer = this.drawer as Drawer;
		let pixels: Uint8Array;
		if (this.options.renderer === 'webgpu') {
			// The render pipeline encodes its output to sRGB itself, so the target keeps its bytes.
			const target = new (
				three as unknown as { RenderTarget: typeof ThreeModule.RenderTarget }
			).RenderTarget(width, height, { samples: MSAA_SAMPLES, colorSpace: three.NoColorSpace });
			renderer.setRenderTarget(target as unknown as ThreeModule.WebGLRenderTarget);
			drawer.render();
			renderer.setRenderTarget(null);
			const data = (await renderer.readRenderTargetPixelsAsync?.(
				target,
				0,
				0,
				width,
				height,
			)) as ArrayBufferView;
			const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			pixels = packRows(bytes, width, height, bytes.length / height, false);
			target.dispose();
		} else {
			drawer.render();
			const gl = renderer.getContext() as WebGL2RenderingContext;
			const bottomFirst = new Uint8Array(width * height * 4);
			gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomFirst);
			pixels = packRows(bottomFirst, width, height, width * 4, true);
		}
		this.post({ type: 'held', width, height, pixels }, [pixels.buffer]);
	}

	/** Posts the frame rate, and the panel's figures while it is open. */
	private report(): void {
		const renderer = this.renderer;
		if (!renderer) return;
		const means = this.means;
		this.rings.window(performance.now() - WINDOW_MS, means);
		const frames = means[0] as number;
		const fps = means[1] as number;
		if (!this.sampling) {
			this.post({ type: 'rate', frames, fps });
			return;
		}
		const info = renderer.info;
		const gpu = means[5] as number;
		const figures: ThreeFigures = {
			frames,
			fps,
			busyMs: means[2] as number,
			codeMs: means[3] as number,
			renderMs: means[4] as number,
			gpuMs: gpu < 0 ? null : gpu,
			drawCalls: info.render.drawCalls ?? info.render.calls ?? 0,
			triangles: info.render.triangles,
			objects: this.objects,
			geometries: info.memory.geometries,
			textures: info.memory.textures,
		};
		this.post({ type: 'figures', figures });
	}

	measure(id: number, seconds: number): void {
		const since = performance.now();
		setTimeout(() => {
			const means = this.means;
			this.rings.window(since, means);
			this.post({
				type: 'measured',
				id,
				frames: means[0] as number,
				fps: means[1] as number,
				cpuMs: means[0] ? (means[2] as number) : null,
				codeMs: means[0] ? (means[3] as number) : null,
				renderMs: means[0] ? (means[4] as number) : null,
			});
		}, seconds * 1000);
	}

	setCount(count: number): void {
		this.build?.setCount(count);
	}

	setSampling(on: boolean): void {
		this.sampling = on;
	}

	resize(width: number, height: number, pixelRatio: number): void {
		const { renderer, build, drawer } = this;
		if (!renderer || !build || !drawer) return;
		renderer.setPixelRatio(pixelRatio);
		renderer.setSize(width, height, false);
		drawer.setSize(width, height, pixelRatio);
		build.camera.aspect = width / height;
		build.camera.updateProjectionMatrix();
	}

	stop(): void {
		if (this.reportTimer) clearInterval(this.reportTimer);
		this.renderer?.setAnimationLoop(null);
		this.renderer?.dispose();
		this.renderer = null;
		this.build = null;
		this.drawer = null;
	}
}

/** RGBA8 rows, top row first, from rows that may be padded and may start at the bottom. */
function packRows(
	bytes: Uint8Array,
	width: number,
	height: number,
	stride: number,
	bottomFirst: boolean,
): Uint8Array {
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const row = bottomFirst ? height - 1 - y : y;
		out.set(bytes.subarray(row * stride, row * stride + width * 4), y * width * 4);
	}
	return out;
}

/** The grading table as a 3D texture of the renderer's build, linearly filtered. */
function gradeTexture(three: Three, grade: GradeTable): ThreeModule.Data3DTexture {
	const texture = new three.Data3DTexture(grade.data, grade.size, grade.size, grade.size);
	texture.format = three.RGBAFormat;
	texture.type = three.UnsignedByteType;
	texture.minFilter = three.LinearFilter;
	texture.magFilter = three.LinearFilter;
	texture.wrapS = texture.wrapT = texture.wrapR = three.ClampToEdgeWrapping;
	texture.unpackAlignment = 1;
	texture.needsUpdate = true;
	return texture;
}

/**
 * The effects of the renderer's build. Every frame draws through them, so the fog and every color
 * stay linear until the output pass applies the curve, as in null3D.
 */
async function makeDrawer(
	three: Three,
	renderer: AnyRenderer,
	build: ThreeSceneBuild,
	options: ThreeStart,
): Promise<Drawer> {
	const { scene, camera, look } = build;
	const { effects } = options;
	if (options.renderer === 'webgpu') {
		const webgpu = three as unknown as typeof import('three/webgpu');
		const tsl = await import('three/tsl');
		// The scene pass keeps the renderer's MSAA. The GTAO node cannot read a multisampled depth
		// buffer, so ambient occlusion reads a depth and normal pass of its own without MSAA, and
		// its denoised result darkens the ambient light inside the scene pass, as three.js's own
		// ambient occlusion example does. GTAOPass on WebGLRenderer also draws such a pass.
		const scenePass = tsl.pass(scene, camera);
		let color = scenePass.getTextureNode('output') as unknown as ReturnType<typeof tsl.vec4>;
		if (effects.ao) {
			const { ao } = await import('three/addons/tsl/display/GTAONode.js');
			const { denoise } = await import('three/addons/tsl/display/DenoiseNode.js');
			const prePass = tsl.pass(scene, camera, { samples: 0 });
			prePass.transparent = false;
			prePass.setMRT(tsl.mrt({ output: tsl.packNormalToRGB(tsl.normalView) }));
			prePass.getTexture('output').type = three.UnsignedByteType;
			const depth = prePass.getTextureNode('depth');
			const normal = tsl.sample((uv) => tsl.unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
			const occlusion = ao(depth, normal, camera);
			occlusion.resolutionScale = look.ao.scale;
			occlusion.radius.value = look.ao.radius;
			const smooth = tsl.convertToTexture(
				denoise(occlusion.getTextureNode(), depth, normal, camera),
			);
			scenePass.contextNode = tsl.builtinAOContext(smooth.sample(tsl.screenUV).r);
		}
		if (effects.bloom) {
			const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
			const { strength, radius, threshold } = look.bloom;
			color = color.add(
				bloom(color, strength * BLOOM_NODE_STRENGTH, radius, threshold),
			) as typeof color;
		}
		const pipeline = new webgpu.RenderPipeline(renderer as never);
		if (effects.grade) {
			const { lut3D } = await import('three/addons/tsl/display/Lut3DNode.js');
			pipeline.outputColorTransform = false;
			pipeline.outputNode = lut3D(
				tsl.renderOutput(color),
				tsl.texture3D(gradeTexture(three, look.grade)),
				look.grade.size,
				tsl.float(1),
			);
		} else pipeline.outputNode = color;
		// The pipeline's pass follows the renderer's size by itself.
		return { render: () => pipeline.render(), setSize: () => {} };
	}
	const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
	const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
	const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');
	const gl = renderer as ThreeModule.WebGLRenderer;
	const { width, height, pixelRatio } = options;
	const target = new three.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
		type: three.HalfFloatType,
		samples: MSAA_SAMPLES,
	});
	const composer = new EffectComposer(gl, target);
	composer.addPass(new RenderPass(scene, camera));
	if (effects.ao) {
		const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js');
		const scale = look.ao.scale;
		const gtao = new GTAOPass(scene, camera, width * scale, height * scale);
		gtao.updateGtaoMaterial({ radius: look.ao.radius });
		// The pass draws its occlusion at the scene's share of the canvas, as null3D does.
		const resize = gtao.setSize.bind(gtao);
		gtao.setSize = (w: number, h: number) => resize(w * scale, h * scale);
		composer.addPass(gtao);
	}
	if (effects.bloom) {
		const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
		const { strength, radius, threshold } = look.bloom;
		composer.addPass(
			new UnrealBloomPass(new three.Vector2(width, height), strength, radius, threshold),
		);
	}
	composer.addPass(new OutputPass());
	if (effects.grade) {
		const { LUTPass } = await import('three/addons/postprocessing/LUTPass.js');
		composer.addPass(new LUTPass({ lut: gradeTexture(three, look.grade), intensity: 1 }));
	}
	const setSize = (w: number, h: number, ratio: number) => {
		composer.setPixelRatio(ratio);
		composer.setSize(w, h);
	};
	setSize(width, height, pixelRatio);
	return { render: () => composer.render(), setSize };
}

/** Runs the worker's side of a comparison with a scene's builder. */
export function runThreeWorker(builder: ThreeBuilder): void {
	const scope = self as unknown as {
		postMessage(message: FromThree, transfer?: Transferable[]): void;
		onmessage: ((event: MessageEvent<ToThree>) => void) | null;
		close(): void;
	};
	let runtime: ThreeRuntime | null = null;
	const fail = (error: unknown) =>
		scope.postMessage({
			type: 'failed',
			message: error instanceof Error ? error.message : String(error),
		});
	scope.onmessage = ({ data: message }) => {
		switch (message.type) {
			case 'start':
				runtime = new ThreeRuntime(
					message.canvas,
					message.options,
					(reply, transfer) => scope.postMessage(reply, transfer ?? []),
					builder,
				);
				runtime.start().catch(fail);
				return;
			case 'count':
				runtime?.setCount(message.count);
				return;
			case 'measure':
				runtime?.measure(message.id, message.seconds);
				return;
			case 'sample':
				runtime?.setSampling(message.on);
				return;
			case 'resize':
				runtime?.resize(message.width, message.height, message.pixelRatio);
				return;
			case 'stop':
				runtime?.stop();
				runtime = null;
				scope.close();
				return;
		}
	};
}
