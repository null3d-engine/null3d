// What every null3d benchmark sketch shares: its object count from its own module address, the
// view (background, sun, ambient light and camera) from the shared scene module, a camera that
// follows a path, and the quality reports that a page's trace records. A sketch poses its scene at
// the sketch time, which hold mode steps to the held time.
import type { Camera, Quality, SketchContext } from '@null3d/engine';
import {
	BACKGROUND,
	CAMERA,
	type OutArray,
	type SceneLights,
	VIEW_LIGHTS,
} from '../../scenes/spec';

/** Reads the object count `n` from the sketch module's address, where the page harness puts it. */
export function readCount(moduleUrl: string): number {
	return Number(new URL(moduleUrl).searchParams.get('n') ?? '0');
}

/**
 * Sets the background, the sun and the ambient light, and makes the active camera. The three.js
 * twins draw with no tone mapping, three.js's default, so the null3D pages turn off the engine's
 * default of ACES.
 */
export function setUpView(
	{ scene, post }: SketchContext,
	{ sun, ambient }: SceneLights = VIEW_LIGHTS,
	background: string = BACKGROUND,
): Camera {
	post.set({ toneMapping: 'none' });
	scene.setBackground(background);
	scene.createDirectionalLight({
		direction: sun.direction,
		color: sun.color,
		intensity: sun.intensity,
		castShadows: sun.castShadows === true,
	});
	scene.createAmbientLight({ color: ambient.color, intensity: ambient.intensity });
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: CAMERA.near,
		far: CAMERA.far,
	});
	scene.setActiveCamera(camera);
	return camera;
}

/** Moves a camera along a path of the shared scene module. It allocates nothing per call. */
export function followPath(
	camera: Camera,
	path: (t: number, outPosition: OutArray, outTarget: OutArray) => void,
): (t: number) => void {
	const position = new Float64Array(3);
	const target = new Float64Array(3);
	return (t) => {
		path(t, position, target);
		camera.setPosition(position[0] as number, position[1] as number, position[2] as number);
		camera.lookAt(target[0] as number, target[1] as number, target[2] as number);
	};
}

/**
 * The name of the message in which a sketch tells its page the render scale and how many quality
 * steps it has seen, for the page's trace of each second.
 */
export const QUALITY_MESSAGE = 'bench-quality';

/**
 * Tells the page the render scale and the count of quality steps, now and after each change. It
 * returns a function to call once per frame, which allocates nothing unless the scale changed.
 */
export function watchQuality({ quality, page }: SketchContext): () => void {
	// Dynamic resolution: the render scale, where the engine has one. Without it, every frame draws
	// the whole canvas, at scale 1.
	const scaled = quality as Quality & { readonly renderScale?: number };
	let scale = scaled.renderScale ?? 1;
	// The quality governor's steps: each step of the render scale, and each change of a live setting
	// that `quality.onChange` reports.
	let steps = 0;
	const report = () => page.post(QUALITY_MESSAGE, [scale, steps]);
	quality.onChange(() => {
		steps++;
		report();
	});
	report();
	return () => {
		const now = scaled.renderScale ?? 1;
		if (now === scale) return;
		scale = now;
		steps++;
		report();
	};
}
