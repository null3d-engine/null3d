// What every null3d benchmark sketch shares: its object count from its own module address, the
// view (background, sun, ambient light and camera) from the shared scene module, and a camera that
// follows a path. A sketch poses its scene at the sketch time, which hold mode steps to the held time.
import type { Camera, SketchContext } from '@null3d/engine';
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
): Camera {
	post.set({ toneMapping: 'none' });
	scene.setBackground(BACKGROUND);
	scene.createDirectionalLight({
		direction: sun.direction,
		color: sun.color,
		intensity: sun.intensity,
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
