// First-person and fly controls: a walk through a ruined temple at golden hour. A scripted walk
// goes up the aisle and back until the user's first key, click or drag. Then first-person controls
// take the camera from where the walk left it: the keys walk, a drag looks, and a click asks the
// page for the pointer lock, so the mouse looks as in a game. Space switches to fly controls, which
// move along the camera's own axes and roll, and back.
import { createFirstPersonControls, createFlyControls } from '@null3d/controls';
import { defineSketch, type MeshOptions, math, quat, timeOfDay, vec3 } from '@null3d/engine';

/** The eye's height over the temple's floor, which stands on three steps. */
const EYE = 2.6;
/** Columns along each side, how far apart, and which of them stand broken. */
const [ROW, GAP, BROKEN] = [7, 3.2, [2, 9, 12]];
/** Seconds that the scripted walk takes up the aisle and back, and the places of the braziers. */
const WALK = 48;
const BRAZIERS = [-1.7, -5, 1.7, -5, -1.7, 5, 1.7, 5];
/** The keys that hand the camera from the scripted walk to the controls. */
const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'Space'];
const WALKING = { movementSpeed: 3, lookSpeed: 0.1, enabled: false };
const FLYING = { movementSpeed: 8, rollSpeed: 0.5, dragToLook: true, enabled: false };

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, input, time } = ctx;
	const day = timeOfDay(17.1, { heading: 0.3 });
	const sky = { ...day.sky, cloudCoverage: 0.35 };
	scene.setBackground({ sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.012, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure, bloom: { threshold: 1 }, ao: {}, vignette: {} });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 50 } });
	const camera = scene.createPerspectiveCamera({ fov: 60, far: 5000 });
	scene.setActiveCamera(camera);

	// Sandstone blocks with dark joints, each block a shade of its own, and grain in each texel.
	math.seed(11);
	const data = new Uint8Array(64 * 64 * 4).fill(255);
	for (let y = 0; y < 64; y++)
		for (let x = 0; x < 64; x++) {
			const block = (y >> 4) * 4 + (((y >> 4) % 2) * 8 + x) / 16;
			const shade = x % 16 === 0 || y % 16 === 0 ? 0.55 : 0.8 + 0.12 * Math.sin(block * 12.9);
			data.fill(shade * math.randFloat(0.92, 1) * 255, (y * 64 + x) * 4, (y * 64 + x) * 4 + 3);
		}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const blocks = textures.fromData({ width: 64, height: 64, data, ...look });
	const stone = (repeat: [number, number]) =>
		materials.standard({ map: blocks, color: '#e3c9a0', roughness: 0.85, uvTransform: { repeat } });
	const [floor, wall] = [stone([6, 13]), stone([1, 1])];
	const plain = materials.standard({ color: '#d9bf96', roughness: 0.8, flatShading: true });
	const box = geometry.box();
	const part = (material: typeof plain, options: Partial<MeshOptions>) =>
		scene.createMesh({ mesh: box, material, castShadows: true, receiveShadows: true, ...options });

	// Sand to the horizon, the temple's three steps, and the wall of its inner room at the far end.
	const sand = materials.standard({ color: '#c9a878', roughness: 1, doubleSided: true });
	const ground = { mesh: geometry.plane({ width: 1e4, height: 1e4 }), castShadows: false };
	part(sand, { ...ground, rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] });
	for (let s = 0; s < 3; s++) {
		const step = { position: [0, 0.15 + s * 0.3, 0], scale: [14 - s, 0.3, 28 - s] } as const;
		part(s === 2 ? floor : wall, step);
	}
	for (const x of [-2.4, 2.4]) part(wall, { position: [x, 3.6, -12], scale: [3.2, 5.4, 1] });
	part(wall, { position: [0, 5.8, -12], scale: [1.6, 1, 1] });

	// Two rows of fluted columns: a base, a shaft and a capital. Lintels join neighbors that stand
	// whole, and a drum of each broken one lies on the floor.
	const shaft = geometry.cylinder({ radiusTop: 0.4, radiusBottom: 0.46, radialSegments: 20 });
	const whole = (i: number) => !BROKEN.includes(i);
	for (let i = 0; i < ROW * 2; i++) {
		const [x, z] = [i < ROW ? -3.6 : 3.6, ((i % ROW) - (ROW - 1) / 2) * GAP];
		const height = whole(i) ? 5 : math.randFloat(1, 2.8);
		part(plain, { position: [x, 1, z], scale: [1.2, 0.2, 1.2] });
		part(plain, { mesh: shaft, position: [x, 1.1 + height / 2, z], scale: [1, height, 1] });
		if (whole(i)) part(wall, { position: [x, 6.25, z], scale: [1.2, 0.3, 1.2] });
		else {
			const rotation = quat.setAxisAngle(quat.create(), [0, 1, 0.2], math.randFloat(0, 3));
			quat.rotateX(rotation, rotation, Math.PI / 2);
			part(plain, { mesh: shaft, position: [x * 0.6, 1.36, z + 1], rotation, scale: [1, 1.1, 1] });
		}
		if (i % ROW < ROW - 1 && whole(i) && whole(i + 1))
			part(wall, { position: [x, 6.7, z + GAP / 2], scale: [1, 0.6, GAP + 1] });
	}

	// Four braziers whose fires flicker, bloom and light the stone around them.
	const fire = materials.standard({ color: '#000000', emissive: '#ff8a2a', emissiveIntensity: 10 });
	const bronze = materials.standard({ color: '#6b4a2a', metalness: 1, roughness: 0.4 });
	const bowl = geometry.cylinder({ radiusTop: 0.35, radiusBottom: 0.15, height: 0.3 });
	const coals = geometry.cone({ radius: 0.2, height: 0.5, radialSegments: 9 });
	const flames: ReturnType<typeof scene.createPointLight>[] = [];
	for (let b = 0; b < BRAZIERS.length; b += 2) {
		const [x, z] = [BRAZIERS[b], BRAZIERS[b + 1]];
		part(bronze, { mesh: bowl, position: [x, 1.95, z] });
		part(bronze, { position: [x, 1.4, z], scale: [0.1, 0.9, 0.1] });
		part(fire, { mesh: coals, position: [x, 2.3, z], castShadows: false });
		flames.push(scene.createPointLight({ position: [x, 2.6, z], color: '#ff9a40', range: 7 }));
	}

	const walk = createFirstPersonControls(ctx, camera, WALKING);
	const fly = createFlyControls(ctx, camera, FLYING);
	const [eye, ahead, turn] = [vec3.create(), vec3.create(), quat.create()];
	let flying = false;
	return {
		onUpdate(dt) {
			const { pointer } = input;
			const t = time.now;
			for (let k = 0; k < flames.length; k++)
				flames[k].setIntensity(4 + Math.sin(t * 13 + k * 2) * 0.8 + Math.sin(t * 7.3 + k) * 0.6);
			if (!walk.enabled && !fly.enabled) {
				// The scripted walk: up the aisle and back, turning at each end, glancing from side
				// to side, with a slight bob of the head.
				const phase = (2 * Math.PI * t) / WALK + 0.6;
				const back = math.smoothstep(-Math.sin(phase), -0.25, 0.25);
				const yaw = Math.PI * back + 0.35 * Math.sin(t * 0.4);
				const z = 3 + 10 * Math.cos(phase);
				vec3.set(eye, 0.6 * Math.sin(t * 0.3), EYE + 0.03 * Math.sin(t * 6), z);
				vec3.set(ahead, eye[0] - Math.sin(yaw), eye[1] - 0.08, eye[2] - Math.cos(yaw));
				camera.setPosition(eye[0], eye[1], eye[2]);
				camera.lookAt(ahead[0], ahead[1], ahead[2]);
				// The user's first key, click, drag or touch hands the camera to the controls.
				let moved = pointer.buttons !== 0 || pointer.locked || input.touches.length > 0;
				for (const key of KEYS) moved ||= input.isDown(key);
				if (moved) walk.lookAt(ahead[0], ahead[1], ahead[2]);
				walk.enabled = moved;
				return;
			}
			if (input.wasPressed('Space')) {
				flying = !flying;
				[fly.enabled, walk.enabled] = [flying, !flying];
				// Walking takes the view's direction from the camera, and drops the roll.
				camera.getRotation(turn);
				camera.getPosition(eye);
				vec3.add(ahead, eye, vec3.transformQuat(ahead, [0, 0, -1], turn));
				if (!flying) walk.lookAt(ahead[0], ahead[1], ahead[2]);
			}
			if (flying && pointer.locked) {
				// Fly controls steer by the pointer's place, which a lock holds still: the mouse
				// turns the camera about its own axes instead.
				camera.getRotation(turn);
				quat.rotateY(turn, turn, -pointer.dx * 0.002);
				quat.rotateX(turn, turn, -pointer.dy * 0.002);
				camera.setRotation(turn[0], turn[1], turn[2], turn[3]);
			}
			(flying ? fly : walk).update(dt);
			// Walking keeps the eye at its height over the floor.
			camera.getPosition(eye);
			if (!flying) camera.setPosition(eye[0], math.damp(eye[1], EYE, 6, dt), eye[2]);
		},
	};
});
