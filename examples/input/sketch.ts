// Input and actions: an action map gives each move a name, and the keyboard and a gamepad both
// press it. The box moves on the floor and jumps. Dragging turns the camera around the box, and
// the wheel or a trackpad pinch moves the camera nearer or farther. math.damp eases the camera.
import { defineSketch, math } from '@null3d/engine';

/** Walking speed, in meters per second. */
const SPEED = 5;
/** The upward speed of a jump, and the pull of gravity. */
const JUMP = 7;
const GRAVITY = 20;
/** How far from the center the box can walk. */
const BOUNDS = 7;
/** Tiles along each side of the floor. */
const TILES = 15;

export default defineSketch(({ scene, geometry, materials, input }) => {
	scene.setBackground('#1b2230');
	const camera = scene.createPerspectiveCamera({ fov: 55, near: 0.1, far: 100 });
	scene.setActiveCamera(camera);
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
	// Where the camera is going, and where it is: its angle around the box and its distance.
	let yaw = 0.6;
	let distance = 11;
	let cameraYaw = yaw;
	let cameraDistance = distance;

	return {
		onUpdate(dt) {
			yaw -= input.pointer.dragDx * 0.008;
			yaw += (input.value('turnRight') - input.value('turnLeft')) * 2.5 * dt;
			distance = math.clamp(distance + input.pointer.wheel * 0.01, 4, 25);

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

			cameraYaw = math.damp(cameraYaw, yaw, 8, dt);
			cameraDistance = math.damp(cameraDistance, distance, 8, dt);
			const cameraX = x + Math.sin(cameraYaw) * cameraDistance;
			const cameraZ = z + Math.cos(cameraYaw) * cameraDistance;
			camera.setPosition(cameraX, 2 + cameraDistance * 0.5, cameraZ);
			camera.lookAt(x, 0.5, z);
		},
	};
});
