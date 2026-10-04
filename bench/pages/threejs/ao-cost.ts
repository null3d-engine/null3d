// What three.js's GTAOPass costs on ambient occlusion's scene (bench/scenes/ao.ts), for comparison
// with null3D's effect cost page (tests/pages/effect-cost.html?effect=ao). The scene fills the
// window at the screen's pixel ratio, as null3D's page does at render scale 1. The page draws the
// composer with GTAOPass's defaults and without the pass, in turns, ROUNDS times each, and reports
// the median GPU time per frame of each side from WebGL2's timer queries, or, where the browser has
// none, the median time of a frame drawn and waited for with readPixels.
import * as three from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { run } from '../../../tests/pages/lib/result';
import { AO_AMBIENT, AO_BACKGROUND, AO_CAMERA, AO_SHAPES } from '../../scenes/ao';

/** Frames before the first measurement, frames of each measurement, and measurements a side. */
const WARM_UP_FRAMES = 60;
const FRAMES = 60;
const ROUNDS = 3;

/** `EXT_disjoint_timer_query_webgl2`, which TypeScript's DOM types do not describe. */
interface TimerQuery {
	readonly TIME_ELAPSED_EXT: number;
	readonly GPU_DISJOINT_EXT: number;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

run('effect-cost', async () => {
	const width = innerWidth;
	const height = innerHeight;
	const renderer = new three.WebGLRenderer({ antialias: false });
	renderer.setPixelRatio(devicePixelRatio);
	renderer.setSize(width, height);
	renderer.toneMapping = three.ACESFilmicToneMapping;
	document.body.append(renderer.domElement);
	const scene = new three.Scene();
	scene.background = new three.Color(AO_BACKGROUND);
	scene.add(new three.AmbientLight(AO_AMBIENT.color, AO_AMBIENT.intensity));
	for (const shape of AO_SHAPES) {
		const [x, y, z] = shape.size;
		const geometry =
			shape.kind === 'box' ? new three.BoxGeometry(x, y, z) : new three.SphereGeometry(x, 32, 16);
		const material = new three.MeshStandardMaterial({ color: shape.color, roughness: 1 });
		const mesh = new three.Mesh(geometry, material);
		mesh.position.set(...shape.position);
		scene.add(mesh);
	}
	const { position, target, fov, near, far } = AO_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);
	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const ao = new GTAOPass(scene, camera, width * devicePixelRatio, height * devicePixelRatio);
	composer.addPass(ao);
	composer.addPass(new OutputPass());

	const gl = renderer.getContext() as WebGL2RenderingContext;
	const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQuery | null;
	const pixel = new Uint8Array(4);
	/** The milliseconds that one frame of the composer takes. */
	const time = async (): Promise<number> => {
		if (timer) {
			const query = gl.createQuery() as WebGLQuery;
			gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
			composer.render();
			gl.endQuery(timer.TIME_ELAPSED_EXT);
			while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) await nextFrame();
			const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
			const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
			gl.deleteQuery(query);
			return disjoint ? Number.NaN : ns / 1e6;
		}
		const start = performance.now();
		composer.render();
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
		return performance.now() - start;
	};
	for (let k = 0; k < WARM_UP_FRAMES; k++) {
		composer.render();
		await nextFrame();
	}
	const sides = { off: [] as number[], on: [] as number[] };
	for (let round = 0; round < ROUNDS; round++) {
		for (const side of ['off', 'on'] as const) {
			ao.enabled = side === 'on';
			const frames: number[] = [];
			for (let k = 0; k < FRAMES; k++) {
				const ms = await time();
				if (!Number.isNaN(ms)) frames.push(ms);
				await nextFrame();
			}
			sides[side].push(median(frames));
		}
	}
	// The effect cost page's shape, so the runner judges both alike.
	const side = (ms: number) => ({ gpuMs: timer ? ms : null, intervalMs: ms, cpuMs: null });
	return {
		effect: 'ao',
		engine: 'three.js',
		timer: timer ? 'timer queries' : 'readPixels',
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off: side(median(sides.off)),
		on: side(median(sides.on)),
		failures: [],
	};
});
