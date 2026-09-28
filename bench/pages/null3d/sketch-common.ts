// What every null3d benchmark sketch shares: its options from its own module address, the view
// (background, lights and camera) from the shared scene module, and a camera that follows a path.
import type { Camera, SketchContext } from '@null3d/engine';
import { AMBIENT, BACKGROUND, CAMERA, type OutArray, SUN } from '../../scenes/spec';

export interface SketchOptions {
	/** The object count. */
	count: number;
	/** The scene time to draw on every frame, or null to follow the sketch's clock. */
	hold: number | null;
}

/** Reads `n` and `holdMs` from the sketch module's address, where the page harness puts them. */
export function readSketchOptions(moduleUrl: string): SketchOptions {
	const params = new URL(moduleUrl).searchParams;
	const holdMs = params.get('holdMs');
	return {
		count: Number(params.get('n') ?? '0'),
		hold: holdMs === null ? null : Number(holdMs) / 1000,
	};
}

/** The scene time of a frame: the held time in hold mode, else the time since the sketch started. */
export function sceneTime(options: SketchOptions, context: SketchContext): number {
	return options.hold ?? context.time.now;
}

/** Sets the background and the lights, and makes the active camera. */
export function setUpView({ scene }: SketchContext): Camera {
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
