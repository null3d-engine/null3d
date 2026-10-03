// Draws another sketch's scene for the shadow checks, in the shadows debug view. ?scene= names the
// scene's sketch module from the server's root, with its own query, and ?at= the sketch time that
// the scene stays at: the scene sees that time in every frame, so nothing in it moves. ?check= says
// how to draw it (see `ShadowCheck`):
//
// - view: the scene's own frame;
// - stability: a still observer camera, where the scene's camera stood, draws the frame, and the
//   scene's camera places the shadow cascades. Each 1/60 s of sketch time past ?at= moves and turns
//   the scene's camera by one step of `CHECK_MOTION`, so hold mode at successive times draws the
//   frames of a slow walk;
// - reference: the scene's frame with the largest shadow map and the widest filter;
// - normals: the scene's own frame in the normals view, which shows where sides meet the ground.
//
// The scene's sketch must pose its scene at the sketch time, as the benchmark sketches do, and draw
// from a perspective camera.
import {
	type Camera,
	type DirectionalLightOptions,
	defineSketch,
	type PerspectiveCamera,
	type Scene,
	type SketchCallbacks,
	type SketchContext,
	type SketchDefinition,
	type SketchTime,
} from '@null3d/engine';
import {
	CHECK_MOTION,
	FRAME_RATE,
	REFERENCE_FILTER,
	REFERENCE_MAP_SIZE,
	type ShadowCheck,
} from '../lib/shadow-check';

const params = new URL(import.meta.url).searchParams;
const scenePath = params.get('scene');
if (!scenePath?.startsWith('/'))
	throw new Error('Add ?scene= with the path of a sketch module from the server root.');
const at = Number(params.get('at') ?? 0);
const check = (params.get('check') ?? 'view') as ShadowCheck;
const inner = (
	(await import(/* @vite-ignore */ new URL(scenePath, import.meta.url).href)) as {
		default: SketchDefinition;
	}
).default;

/** `target` with some of its members replaced, and its methods bound to it. */
function withMembers<T extends object>(target: T, members: Partial<T>): T {
	return new Proxy(target, {
		get(object, key) {
			if (key in members) return members[key as keyof T];
			const value = Reflect.get(object, key, object);
			return typeof value === 'function' ? value.bind(object) : value;
		},
	});
}

/** Multiplies quaternion `q` by a turn of `angle` radians about the world's up, from the left. */
function turnAboutUp(q: Float64Array, angle: number): void {
	const [s, c] = [Math.sin(angle / 2), Math.cos(angle / 2)];
	const [x, y, z, w] = q as unknown as [number, number, number, number];
	q[0] = c * x + s * z;
	q[1] = c * y + s * w;
	q[2] = c * z - s * x;
	q[3] = c * w - s * y;
}

export default defineSketch(async (context) => {
	const { scene, time, debug, quality } = context;
	let main: Camera | undefined;
	const members: Partial<Scene> = {
		setActiveCamera(camera: Camera) {
			main = camera;
			if (check !== 'stability') scene.setActiveCamera(camera);
		},
	};
	if (check === 'reference')
		members.createDirectionalLight = (options: DirectionalLightOptions = {}) =>
			scene.createDirectionalLight(
				options.castShadows
					? { ...options, shadow: { ...options.shadow, mapSize: REFERENCE_MAP_SIZE } }
					: options,
			);
	const frozen = withMembers(time, { now: at } as Partial<SketchTime>);
	const callbacks: SketchCallbacks =
		(await inner.setup(
			withMembers(context, {
				scene: withMembers(scene, members),
				time: frozen,
			} as Partial<SketchContext>),
		)) ?? {};
	debug.view(check === 'normals' ? 'normals' : 'shadows');
	if (check === 'reference') await quality.set({ shadowFilter: REFERENCE_FILTER });
	if (check !== 'stability' || !main) return callbacks;

	// The observer stands where the scene's camera stands at the held time, with its lens.
	const camera = main as PerspectiveCamera;
	if (camera.isOrthographic) throw new Error('the stability check needs a perspective camera');
	const position = new Float64Array(3);
	const rotation = new Float64Array(4);
	camera.getPosition(position);
	camera.getRotation(rotation);
	const observer = scene.createPerspectiveCamera({
		fov: camera.fov,
		near: camera.near,
		far: camera.far,
	});
	observer.setPosition(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
	observer.setRotation(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1);
	scene.setActiveCamera(observer);
	debug.shadowCamera(camera);
	// The camera's view and its side over the ground, from its rotation.
	const [x, y, z, w] = rotation as unknown as [number, number, number, number];
	const forward = [-2 * (x * z + w * y), 0, -(1 - 2 * (x * x + y * y))];
	const length = Math.hypot(forward[0] ?? 0, forward[2] ?? 0) || 1;
	const [fx, fz] = [(forward[0] ?? 0) / length, (forward[2] ?? 1) / length];
	const moved = new Float64Array(4);
	/** Moves the scene's camera by one step of the motion for each frame past the held time. */
	const move = () => {
		const steps = Math.round((time.now - at) * FRAME_RATE);
		const ahead = steps * CHECK_MOTION.forward;
		const side = steps * CHECK_MOTION.side;
		camera.setPosition(
			(position[0] ?? 0) + ahead * fx - side * fz,
			position[1] ?? 0,
			(position[2] ?? 0) + ahead * fz + side * fx,
		);
		moved.set(rotation);
		turnAboutUp(moved, (steps * CHECK_MOTION.yawDegrees * Math.PI) / 180);
		camera.setRotation(moved[0] ?? 0, moved[1] ?? 0, moved[2] ?? 0, moved[3] ?? 1);
	};
	move();
	return {
		...callbacks,
		onUpdate(dt) {
			callbacks.onUpdate?.(dt);
			move();
		},
	};
}, inner.options);
