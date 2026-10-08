// A security camera: a camera on a pole sweeps a yard behind a brick wall, or aims where the pointer
// points, and a scene pass draws its view into a texture. A monitor on the near side of the wall
// shows it, with the robot that patrols out of the main camera's sight. The pass never draws an
// object that shows its own texture, so the monitor stays out of its own picture. Scene passes draw
// no point or spot lights yet, so the yard has only the sun, its shadows and the ambient light.
import { defineSketch, type Material, type Vec3, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** A quarter turn about X, which lays a plane flat or points a cylinder along Z. */
const QUARTER_X = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
/** The crates behind the wall, clear of the robot's patrol: x, z and the size of each. */
const CRATES = [
	[-4.6, -2.2, 1.1],
	[-3.8, -1.2, 0.6],
	[-1.4, -4.3, 1],
	[-0.4, -3.9, 0.6],
	[4.4, -7.6, 0.9],
] as const;
/** The trees behind the wall: x and z of each. */
const TREES = [
	[-5, -7.5],
	[1.4, -8.2],
	[5.2, -7.2],
] as const;
/** The robot's patrol: an ellipse in meters, a start angle, and radians walked per second. */
const PATROL = { x: 3.2, z: 2, centerZ: -4.6, start: Math.PI, speed: 0.6 };
/** The security camera's place, on top of its pole behind the wall. */
const EYE: Vec3 = [3, 3.9, -0.8];

export default defineSketch((ctx) => {
	const { scene, geometry, materials, textures, render, time } = ctx;
	scene.setBackground('#8fb3cf');
	scene.createDirectionalLight({
		direction: [-0.6, -1.5, -1.3],
		intensity: 3,
		castShadows: true,
		shadow: { distance: 30 },
	});
	scene.createAmbientLight({ color: '#dbe8ff', intensity: 0.8 });

	const box = geometry.box();
	const solid = (color: string, roughness = 0.8) => materials.standard({ color, roughness });
	const block = (material: Material, position: Vec3, scale: Vec3) =>
		scene.createMesh({
			mesh: box,
			material,
			position,
			scale,
			castShadows: true,
			receiveShadows: true,
		});

	scene.createMesh({
		mesh: geometry.plane({ width: 40, height: 40 }),
		material: materials.standard({ color: '#7d8a6a', roughness: 0.95, doubleSided: true }),
		rotation: QUARTER_X,
		receiveShadows: true,
	});
	block(solid('#a85a44'), [0, 1.4, 0], [12, 2.8, 0.3]);
	block(solid('#6b5a4a'), [0, 0.9, -9.5], [14, 1.8, 0.2]);
	const wood = solid('#c49a5a');
	for (const [x, z, size] of CRATES) block(wood, [x, size / 2, z], [size, size, size]);
	const trunk = geometry.cylinder({ radiusTop: 0.15, radiusBottom: 0.2, height: 1.6 });
	const crown = geometry.cone({ radius: 1.3, height: 3.6 });
	const bark = solid('#6b4a32');
	const leaves = solid('#3f7a46');
	for (const [x, z] of TREES) {
		scene.createMesh({ mesh: trunk, material: bark, position: [x, 0.8, z], castShadows: true });
		scene.createMesh({ mesh: crown, material: leaves, position: [x, 3.4, z], castShadows: true });
	}

	// The robot faces +Z, where its visor is.
	const dark = solid('#1d2430', 0.3);
	const robot = scene.createMesh({
		mesh: geometry.capsule({ radius: 0.35, height: 0.9 }),
		material: solid('#f2a93b', 0.5),
		dynamic: true,
		castShadows: true,
	});
	scene.createMesh({
		mesh: box,
		material: dark,
		position: [0, 0.35, 0.3],
		scale: [0.5, 0.16, 0.16],
		parent: robot,
	});

	// The security camera on its pole. Its housing hangs from the camera, behind the lens, so it
	// turns with the camera and stays out of the camera's view.
	block(solid('#5a5f68'), [EYE[0], EYE[1] / 2, EYE[2] + 0.2], [0.14, EYE[1], 0.14]);
	const security = scene.createPerspectiveCamera({ fov: 50, near: 0.3, far: 60, position: EYE });
	const housing = solid('#e8e8e4', 0.4);
	scene.createMesh({
		mesh: box,
		material: housing,
		position: [0, 0.04, 0.25],
		scale: [0.28, 0.24, 0.46],
		parent: security,
	});
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 0.08, radiusBottom: 0.08, height: 0.08 }),
		material: dark,
		rotation: QUARTER_X,
		parent: security,
	});

	// The scene pass draws the security camera's view into a 16:9 texture, which the monitor shows.
	const size = [512, 288] as const;
	const feed = render.addPass({ kind: 'scene', camera: security, writes: 'security', size });
	block(solid('#22252b', 0.4), [-1.6, 1.45, 0.22], [3.6, 2.15, 0.12]);
	scene.createMesh({
		mesh: geometry.plane({ width: 3.36, height: 1.89 }),
		material: materials.unlit({ map: textures.fromPass(feed) }),
		position: [-1.6, 1.45, 0.29],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.05 }),
		material: materials.standard({ color: '#000000', emissive: '#ff3030', emissiveIntensity: 4 }),
		position: [0.04, 2.4, 0.3],
	});

	const look: Vec3 = [-0.2, 1.8, 0];
	const camera = scene.createPerspectiveCamera({ position: [-1.398, 2.16, 5.59], target: look });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, {
		target: look,
		maxPolarAngle: Math.PI * 0.48,
		minDistance: 3,
		maxDistance: 20,
		groundY: 0,
		bounds: [-6, 0, -9, 6, 0, -1.5],
	});
	const aim = vec3.create();

	return {
		onUpdate(dt) {
			// The robot walks its ellipse, turned to face the way it walks.
			const angle = PATROL.start + time.now * PATROL.speed;
			const sin = Math.sin(angle);
			const cos = Math.cos(angle);
			robot.setPosition(cos * PATROL.x, 0.8, PATROL.centerZ + sin * PATROL.z);
			robot.setRotationEuler(0, Math.atan2(-sin * PATROL.x, cos * PATROL.z), 0);
			// The security camera sweeps from one side of the yard to the other, or aims where pointed.
			view.update(dt);
			view.steer(vec3.set(aim, -Math.sin(time.now * 0.45) * 3.5, 0.6, PATROL.centerZ));
			security.lookAt(aim[0], aim[1], aim[2]);
		},
	};
});
