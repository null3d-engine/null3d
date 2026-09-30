// A camera that follows a moving box from onLateUpdate. The box moves only in fixed steps, 50 per
// second of sketch time, at 30 meters per second along a row of posts. The late update reads the
// box's world position after the engine updated the frame's transforms, and moves the camera, which
// the engine updates again before it draws. So the box stays at the image center in every frame; a
// camera that followed in onUpdate would trail it by a frame. The sketch counts its callbacks,
// checks their order in each frame and the time they see, and checks that the late update reads the
// frame's own positions. On the message `state` it sends those counts and checks, and its view of the
// engine. It answers once a live engine has run half a second, and at once after a hold.
import { defineSketch, vec3 } from '@null3d/engine';

/** Fixed steps per second, which differ from hold mode's 60 frames per second. */
const FIXED_RATE = 50;
/** How fast the box moves, in meters per second. */
const SPEED = 30;
/** Posts along the box's path, 2 meters apart. */
const POSTS = 40;
/** Sketch time after which a live engine answers. */
const ANSWER_AFTER = 0.5;

export default defineSketch(
	({ scene, geometry, materials, page, time, engine }) => {
		scene.setBackground('#101418');
		const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.1, far: 200 });
		scene.setActiveCamera(camera);
		scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
		scene.createAmbientLight({ intensity: 0.4 });
		const box = geometry.box();
		const posts = scene.createInstances(box, POSTS, {
			material: materials.standard({ color: '#4a8cff' }),
		});
		for (let i = 0; i < POSTS; i++) {
			posts.positions.set([i * 2 - 10, 0.5, -3], i * 3);
			posts.rotations.set([0, 0, 0, 1], i * 4);
			posts.scales.set([0.3, 3, 0.3], i * 3);
		}
		posts.markDirty();
		const target = scene.createMesh({
			mesh: box,
			material: materials.unlit({ color: '#ff0000' }),
			position: [0, 0.5, 0],
			dynamic: true,
		});

		const at = vec3.create();
		let x = 0;
		let fixedSteps = 0;
		let updates = 0;
		let lateUpdates = 0;
		/** Callbacks that ran out of order: a fixed step after the update, or a late update before it. */
		let outOfOrder = 0;
		/** Late updates that read another place than the box's place in the frame. */
		let staleReads = 0;
		/** Callbacks whose step differed from time.dt. */
		let stepMismatches = 0;
		let updatedFrame = 0;
		let lateFrame = 0;
		let asked = false;

		const answer = () => {
			asked = false;
			const { viewport, capabilities } = engine;
			page.post('state', {
				now: time.now,
				frame: time.frame,
				fixedSteps,
				updates,
				lateUpdates,
				outOfOrder,
				staleReads,
				stepMismatches,
				x,
				viewport: [viewport.width, viewport.height, viewport.pixelRatio],
				tier: capabilities.tier,
			});
		};
		page.onMessage((name) => {
			if (name !== 'state') return;
			asked = true;
			if (time.now >= ANSWER_AFTER) answer();
		});

		return {
			onFixedUpdate(step) {
				fixedSteps++;
				if (updatedFrame === time.frame || lateFrame === time.frame) outOfOrder++;
				x += SPEED * step;
				target.setPosition(x, 0.5, 0);
			},
			onUpdate(dt) {
				updates++;
				if (lateFrame === time.frame) outOfOrder++;
				if (dt !== time.dt) stepMismatches++;
				updatedFrame = time.frame;
				if (asked && time.now >= ANSWER_AFTER) answer();
			},
			onLateUpdate(dt) {
				lateUpdates++;
				if (updatedFrame !== time.frame) outOfOrder++;
				if (dt !== time.dt) stepMismatches++;
				lateFrame = time.frame;
				target.getWorldPosition(at);
				if (Math.abs(at[0] - x) > 1e-3) staleReads++;
				camera.setPosition(at[0], at[1] + 2, at[2] + 6);
				camera.lookAt(at[0], at[1], at[2]);
			},
		};
	},
	{ fixedRate: FIXED_RATE },
);
