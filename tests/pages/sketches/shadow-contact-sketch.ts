// Car-sized boxes standing on a street under the S4 town's sun, to show where their shadows meet
// them. The ground receives shadows and casts none, as S4's street does. The small shadow map gives
// the last of the three cascades texels of about the size that S4's last cascade has.
//
// ?view= picks the camera. `top`, the default, looks down from 100 m through a narrow lens, so the
// boxes stand in the last cascade. `near` stands at eye height a few meters from a box, in the
// first cascade, and `far` looks at the same box from about 100 m away and 45 m up, in the last
// one. Both look at the side where the shadow falls, so the line where it meets the box shows.
// `turn` looks at that side from 27 m away, just past where the first cascade ends. ?yaw=<degrees>
// turns the camera left on the spot. From about 17 degrees, the box's distance along the view falls
// inside the first cascade, while its distance from the camera stays the same. `lit` stands at eye
// height on the sun's side, where the box's lit sides face it, one of them at 19 degrees to the
// sun's light. ?groundCasts makes the ground cast shadows too, as a slab 20 cm thick, whose top
// then compares with its own bottom.
//
// ?moving adds a blue box that drives to and fro along x at 10 m/s, dynamic, behind the still red
// ones. ?far=<n> sets the frames between two draws of a far cascade, 1 by default, and turns off
// the governor, which would lengthen it. ?bias= and ?normalBias= set the light's biases, and
// ?mapSize= the shadow map's texels on each side, 512 by default.
import { defineSketch } from '@null3d/engine';
import { CONTACT_AIM_HEIGHT, CONTACT_TURN } from '../lib/shadow-turn';

const params = new URL(import.meta.url).searchParams;
/** The frames between two draws of a far cascade, from the sketch module's ?far switch. */
const FAR = Number(params.get('far') ?? 1);
/** The light's shadow biases from the sketch module's ?bias and ?normalBias switches, if any. */
const BIASES = {
	...(params.has('bias') && { bias: Number(params.get('bias')) }),
	...(params.has('normalBias') && { normalBias: Number(params.get('normalBias')) }),
};
/** True when the sketch module's ?moving switch adds the driving box. */
const MOVING = params.has('moving');
/** Texels on each side of the shadow map, from the sketch module's ?mapSize switch. */
const MAP_SIZE = Number(params.get('mapSize') ?? 512);
/** True when the sketch module's ?groundCasts switch makes the ground cast shadows. */
const GROUND_CASTS = params.has('groundCasts');

/** A car's size along x, y and z, in meters: S4's commonest vehicle. */
const CAR = [4.2, 1.5, 1.8] as const;
/** The box that the near and far views look at, where it stands on the ground. */
const WATCHED = [1, 0, 3] as const;
/** How far the driving box goes from the middle each way, in meters, and its speed in m/s. */
const DRIVE = { reach: 8, speed: 10 } as const;

/** Each view's lens and where it stands, relative to the watched box. */
const VIEWS = {
	top: { fov: 10, from: [-1, 100, 9] },
	near: { fov: 50, from: [-5, 1.7, -6] },
	far: { fov: 6, from: [-50, 45, -70] },
	turn: { fov: CONTACT_TURN.fovDegrees, from: CONTACT_TURN.from },
	lit: { fov: 50, from: [6, 1.7, 7] },
} as const;
/** How far the camera turns left on the spot, in degrees, from the sketch module's ?yaw switch. */
const YAW = (Number(params.get('yaw') ?? 0) * Math.PI) / 180;

export default defineSketch(({ scene, materials, geometry, quality, time }) => {
	quality.set({ farCascadeInterval: FAR, governor: false, shadowFilter: 3 });
	scene.setBackground('#202830');
	const view = VIEWS[(params.get('view') ?? 'top') as keyof typeof VIEWS];
	const [x, y, z] = WATCHED;
	// The target turns around the camera's vertical axis.
	const [dx, dz] = [-view.from[0], -view.from[2]];
	const [cos, sin] = [Math.cos(YAW), Math.sin(YAW)];
	const position = [x + view.from[0], y + view.from[1], z + view.from[2]] as const;
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: view.fov,
			position,
			target: [
				position[0] + cos * dx + sin * dz,
				y + CONTACT_AIM_HEIGHT,
				position[2] - sin * dx + cos * dz,
			],
			near: 0.5,
			far: 400,
		}),
	);
	scene.createDirectionalLight({
		direction: [-0.6, -1, -0.4],
		color: '#ffffff',
		intensity: 3,
		castShadows: true,
		shadow: { cascades: 3, mapSize: MAP_SIZE, distance: 200, ...BIASES },
	});
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	scene.createMesh({
		mesh: geometry.box({ width: 300, height: 0.2, depth: 300 }),
		material: materials.standard({ color: '#c8ccd0' }),
		position: [0, -0.1, 0],
		receiveShadows: true,
		castShadows: GROUND_CASTS,
	});
	const car = geometry.box({ width: CAR[0], height: CAR[1], depth: CAR[2] });
	const red = materials.standard({ color: '#e8554e' });
	for (const [bx, bz] of [
		[-7, 2],
		[x, z],
	] as const)
		scene.createMesh({
			mesh: car,
			material: red,
			position: [bx, CAR[1] / 2, bz],
			castShadows: true,
			receiveShadows: true,
		});
	if (!MOVING) return;

	const driving = scene.createMesh({
		mesh: car,
		material: materials.standard({ color: '#3a6cff' }),
		position: [0, CAR[1] / 2, -3],
		dynamic: true,
		castShadows: true,
		receiveShadows: true,
	});
	return {
		onUpdate() {
			// A triangle wave: the box drives at one speed, and turns at each end.
			const period = (4 * DRIVE.reach) / DRIVE.speed;
			const phase = (time.now % period) / period;
			const at = DRIVE.reach * (phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase);
			driving.setPosition(at, CAR[1] / 2, -3);
		},
	};
});
