// Input and actions: an action map gives each move a name, and the keyboard and a gamepad both
// press it. The box moves on the floor and jumps, and the camera follows it. Orbit controls turn
// the camera around the box from the user's first drag, scroll or pinch, and follow the box after.
import { defineSketch, math, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Walking speed, in meters per second. */
const SPEED = 5;
/** The upward speed of a jump, and the pull of gravity. */
const JUMP = 7;
const GRAVITY = 20;
/** How far from the center the box can walk. */
const BOUNDS = 7;
/** Tiles along each side of the floor. */
const TILES = 15;
/** The camera's distance from the box, until the user moves it. */
const DISTANCE = 11;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, input } = ctx;
	scene.setBackground('#1b2230');
	const camera = scene.createPerspectiveCamera({ fov: 55, near: 0.1, far: 100 });
	scene.setActiveCamera(camera);
	// The point that the camera looks at: the box, at the height of its middle.
	const look = vec3.set(vec3.create(), 0, 0.5, 0);
	const view = interact(ctx, camera, {
		target: look,
		maxPolarAngle: Math.PI * 0.48,
		minDistance: 4,
		maxDistance: 25,
	});
	scene.createDirectionalLight({ direction: [-1, -2, -0.8], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });

	// A checkered floor: one static batch for each color.
	const tile = geometry.box({ width: 1, height: 0.2, depth: 1 });
	const pale = scene.createInstances(tile, Math.ceil((TILES * TILES) / 2), {
		material: materials.standard({ color: '#3d4a60' }),
	});
	const dark = scene.createInstances(tile, Math.floor((TILES * TILES) / 2), {
		material: materials.standard({ color: '#2a3344' }),
	});
	for (let i = 0; i < TILES * TILES; i++) {
		const batch = i % 2 === 0 ? pale : dark;
		const row = Math.floor(i / 2);
		batch.positions.set(
			[(i % TILES) - (TILES - 1) / 2, -0.1, Math.floor(i / TILES) - (TILES - 1) / 2],
			row * 3,
		);
	}

	const colors = ['#e8554e', '#5bc27a', '#f2c14e', '#4a8cff'].map((color) =>
		materials.standard({ color }),
	);
	let color = 0;
	const player = scene.createMesh({ mesh: geometry.box(), material: colors[0], dynamic: true });

	input.actions.define({
		left: ['KeyA', 'ArrowLeft', 'GamepadLeftStickLeft'],
		right: ['KeyD', 'ArrowRight', 'GamepadLeftStickRight'],
		forward: ['KeyW', 'ArrowUp', 'GamepadLeftStickUp'],
		back: ['KeyS', 'ArrowDown', 'GamepadLeftStickDown'],
		jump: ['Space', 'GamepadA'],
		paint: ['KeyE', 'GamepadX'],
		turnLeft: ['GamepadRightStickLeft'],
		turnRight: ['GamepadRightStickRight'],
	});

	let x = 0;
	let z = 0;
	let height = 0;
	let rise = 0;
	// The camera's angle around the box, until the user turns it.
	let yaw = 0.6;

	return {
		onUpdate(dt) {
			// The right stick turns the camera, before and after the user takes it.
			const stick = (input.value('turnRight') - input.value('turnLeft')) * 2.5 * dt;
			if (view.userCamera) {
				view.controls.rotateLeft(-stick);
				yaw = view.controls.getAzimuthalAngle();
			} else yaw += stick;

			// Walk relative to the camera: forward goes away from it.
			const across = input.value('right') - input.value('left');
			const ahead = input.value('forward') - input.value('back');
			const sin = Math.sin(yaw);
			const cos = Math.cos(yaw);
			x = math.clamp(x + (across * cos - ahead * sin) * SPEED * dt, -BOUNDS, BOUNDS);
			z = math.clamp(z - (across * sin + ahead * cos) * SPEED * dt, -BOUNDS, BOUNDS);

			if (input.wasPressed('jump') && height === 0) rise = JUMP;
			rise -= GRAVITY * dt;
			height = Math.max(0, height + rise * dt);
			if (height === 0) rise = 0;
			player.setPosition(x, 0.5 + height, z);

			if (input.wasPressed('paint')) {
				color = (color + 1) % colors.length;
				player.setMaterial(colors[color]);
			}
		},
		onLateUpdate(dt) {
			// The camera follows the box. Until the user takes it, the script places it. From then on,
			// the user's camera and its target move with the box.
			if (!view.userCamera) {
				camera.setPosition(
					x + Math.sin(yaw) * DISTANCE,
					2 + DISTANCE * 0.5,
					z + Math.cos(yaw) * DISTANCE,
				);
				camera.lookAt(x, 0.5, z);
			}
			view.shift(x - look[0], 0, z - look[2]);
			vec3.set(look, x, 0.5, z);
			view.update(dt);
		},
	};
});
