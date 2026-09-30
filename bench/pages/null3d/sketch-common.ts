// What every null3d benchmark sketch shares: its object count from its own module address, the
// view (background, lights and camera) from the shared scene module, and a camera that follows a
// path. A sketch poses its scene at the sketch time, which hold mode steps to the held time.
import type { Camera, SketchContext } from '@null3d/engine';
import { AMBIENT, BACKGROUND, CAMERA, type OutArray, SUN } from '../../scenes/spec';

/** Reads the object count `n` from the sketch module's address, where the page harness puts it. */
export function readCount(moduleUrl: string): number {
	return Number(new URL(moduleUrl).searchParams.get('n') ?? '0');
}

/**
 * Sets the background and the lights, and makes the active camera. The three.js twins draw with no
 * tone mapping, three.js's default, so the null3D pages turn off the engine's default of ACES.
 */
export function setUpView({ scene, post }: SketchContext): Camera {
	post.set({ toneMapping: 'none' });
	scene.setBackground(BACKGROUND);
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
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
