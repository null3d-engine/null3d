// The sketch module, in the sketch worker: a small game. The player runs over a field, picks up
// every gem and keeps clear of the rocks. A round ends when the last gem is taken, and the next one
// scatters the gems again. Keys, a gamepad's left stick, or a finger dragged on the screen move the
// player. The page shows the score.
import { defineSketch, math, quat, timeOfDay } from '@null3d/engine';

/** The half width of the field, the player's speed in meters a second, and its radius. */
const FIELD = 14;
const SPEED = 6;
const PLAYER_RADIUS = 0.4;
/** The number of gems and rocks, and the reach that picks up a gem. */
const GEMS = 12;
const ROCKS = 30;
const PICKUP = 0.9;
/** How far a finger must drag, in CSS pixels, to move the player at full speed. */
const DRAG_FULL = 60;
/** The axis that the gems spin around, and where the camera sits behind and above the player. */
const UP: [number, number, number] = [0, 1, 0];
const CAMERA_HEIGHT = 9;
const CAMERA_BACK = 11;

export default defineSketch(async ({ scene, geometry, materials, assets, input, page, time }) => {
	const day = timeOfDay(15.5, { heading: -0.4 });
	scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.createDirectionalLight({ ...day.light, castShadows: true });

	const camera = scene.createPerspectiveCamera({
		fov: 55,
		position: [0, CAMERA_HEIGHT, CAMERA_BACK],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);

	scene.createMesh({
		mesh: geometry.plane({ width: FIELD * 2 + 4, height: FIELD * 2 + 4 }),
		material: materials.standard({ color: '#6f9a52', roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	const player = scene.createMesh({
		mesh: geometry.capsule({ radius: PLAYER_RADIUS, height: 0.6 }),
		material: materials.standard({ color: '#f2c14e', roughness: 0.4 }),
		position: [0, 0.7, 0],
		castShadows: true,
		dynamic: true,
	});

	// The rocks stand still, so their batch is static: the rows are written once, at the start.
	const rocks = scene.createInstances(geometry.sphere({ radius: 1 }), ROCKS, {
		material: materials.standard({ color: '#8b8680', roughness: 0.9 }),
		castShadows: true,
		receiveShadows: true,
	});
	const rockRadius = new Float32Array(ROCKS);
	for (let i = 0; i < ROCKS; i++) {
		const r = 0.5 + Math.random() * 0.7;
		rockRadius[i] = r;
		// Keep the middle clear, where the player starts.
		const angle = Math.random() * Math.PI * 2;
		const distance = 3 + Math.random() * (FIELD - 3);
		rocks.positions.set([Math.cos(angle) * distance, r * 0.4, Math.sin(angle) * distance], i * 3);
		rocks.scales.set([r, r * 0.7, r], i * 3);
	}

	// The gems spin every frame, so their batch is dynamic. A taken gem shrinks to nothing.
	const gems = scene.createInstances(
		geometry.sphere({ radius: 0.3, widthSegments: 4, heightSegments: 2 }),
		GEMS,
		{
			material: materials.standard({
				color: '#4ad8ff',
				emissive: '#1a7fa8',
				metalness: 0.2,
				roughness: 0.15,
			}),
			dynamic: true,
			castShadows: true,
		},
	);
	const taken = new Uint8Array(GEMS);
	const spin = quat.create();

	/** Puts every gem back, each in a free place away from the rocks. */
	function scatterGems() {
		for (let i = 0; i < GEMS; i++) {
			let x = 0;
			let z = 0;
			do {
				x = (Math.random() * 2 - 1) * (FIELD - 1);
				z = (Math.random() * 2 - 1) * (FIELD - 1);
			} while (nearRock(x, z, 0.6) >= 0 || x * x + z * z < 4);
			gems.positions.set([x, 0.6, z], i * 3);
			gems.scales.set([1, 1.4, 1], i * 3);
			taken[i] = 0;
		}
	}

	/** The first rock within `reach` of the point's edge, or -1. */
	function nearRock(x: number, z: number, reach: number) {
		const p = rocks.positions;
		for (let i = 0; i < ROCKS; i++) {
			const dx = x - p[i * 3];
			const dz = z - p[i * 3 + 2];
			const limit = rockRadius[i] + reach;
			if (dx * dx + dz * dz < limit * limit) return i;
		}
		return -1;
	}

	scatterGems();

	input.actions.define({
		left: ['KeyA', 'ArrowLeft', 'GamepadLeftStickLeft'],
		right: ['KeyD', 'ArrowRight', 'GamepadLeftStickRight'],
		forward: ['KeyW', 'ArrowUp', 'GamepadLeftStickUp'],
		back: ['KeyS', 'ArrowDown', 'GamepadLeftStickDown'],
	});

	// The player's place and heading, the score, and the gems left in this round.
	let x = 0;
	let z = 0;
	let heading = 0;
	let score = 0;
	let left = GEMS;
	// The finger that steers, and where it went down: a stick that appears under the thumb.
	let finger = -1;
	let startX = 0;
	let startY = 0;
	// The point on the field that the camera follows, which eases toward the player.
	let followX = 0;
	let followZ = 0;
	page.post('score', score);

	return {
		onUpdate(dt) {
			// Keys and the gamepad give a direction on the field.
			let across = input.value('right') - input.value('left');
			let ahead = input.value('forward') - input.value('back');

			// A finger steers by how far it has dragged from where it went down.
			let steering = false;
			const { touches } = input;
			for (let i = 0; i < touches.length; i++) {
				const touch = touches[i];
				if (!touch) continue;
				if (finger === -1) {
					finger = touch.id;
					startX = touch.x;
					startY = touch.y;
				}
				if (touch.id !== finger) continue;
				across = math.clamp((touch.x - startX) / DRAG_FULL, -1, 1);
				ahead = math.clamp((startY - touch.y) / DRAG_FULL, -1, 1);
				steering = true;
			}
			if (!steering) finger = -1;

			// Diagonals move no faster than straight lines.
			const length = Math.hypot(across, ahead);
			if (length > 1) {
				across /= length;
				ahead /= length;
			}
			let nx = math.clamp(x + across * SPEED * dt, -FIELD, FIELD);
			let nz = math.clamp(z - ahead * SPEED * dt, -FIELD, FIELD);

			// A rock stops the player at its edge: push the player back out along the line to it.
			const hit = nearRock(nx, nz, PLAYER_RADIUS);
			if (hit >= 0) {
				const p = rocks.positions;
				const dx = nx - p[hit * 3];
				const dz = nz - p[hit * 3 + 2];
				const scale = (rockRadius[hit] + PLAYER_RADIUS) / Math.max(Math.hypot(dx, dz), 1e-4);
				nx = p[hit * 3] + dx * scale;
				nz = p[hit * 3 + 2] + dz * scale;
			}
			if (nx !== x || nz !== z) heading = Math.atan2(nx - x, nz - z);
			x = nx;
			z = nz;
			player.setPosition(
				x,
				0.7 + Math.abs(Math.sin(time.now * 10)) * 0.08 * Math.min(length, 1),
				z,
			);
			player.setRotationEuler(0, heading, 0);

			// Spin the gems that are left, and pick up those in reach.
			quat.setAxisAngle(spin, UP, time.now * 2);
			const p = gems.positions;
			for (let i = 0; i < GEMS; i++) {
				if (taken[i]) continue;
				gems.rotations.set(spin, i * 4);
				const dx = x - p[i * 3];
				const dz = z - p[i * 3 + 2];
				if (dx * dx + dz * dz > PICKUP * PICKUP) continue;
				taken[i] = 1;
				gems.scales.fill(0, i * 3, i * 3 + 3);
				page.post('score', ++score);
				if (--left === 0) {
					scatterGems();
					left = GEMS;
				}
			}
		},
		onLateUpdate(dt) {
			// The camera follows the player from behind and above, and eases toward it.
			const ease = 1 - Math.exp(-4 * dt);
			followX += (x - followX) * ease;
			followZ += (z - followZ) * ease;
			camera.setPosition(followX, CAMERA_HEIGHT, followZ + CAMERA_BACK);
			camera.lookAt(followX, 0.5, followZ);
		},
	};
});
