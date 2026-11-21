// A waterfall drawn by @null3d/water under an overcast sky. A creek 5.6 m wide runs between two banks
// to the edge of a dark cliff and falls from its lip into a grey sea of cloud 12 m below it, with
// the Creek garden's settings for its falls: a glassy tongue over the lip, then a solid white
// column of rough ropes that draws in from its sides, breaks up and bursts into mist above the
// cloud and vanishes into it, with a froth at the lip and a plume at the foot. The column's streaks
// move with the time alone and the spray's systems start full, so the held frame shows the running
// fall. The picture so guards the column's broken sides, seen from the front, and its fade into
// the cloud. The `view`
// switch moves the camera: `near` stands 10 m from the fall, `side` looks square across its path,
// past the gap between the water and the wall, and `profile` sees it side-on from above, as the
// concept's camera sees its left fall. `spray=0` leaves the spray and mist out.
import { defineSketch } from '@null3d/engine';
import { createWater, createWaterfall } from '@null3d/water';

/** The creek's half width at the lip, its current there, and how far the fall drops, in meters. */
const HALF = 2.8;
const SPEED = 1.2;
const DROP = 14;
/** The height of the rock under the creek's bed, of the banks beside it, and of the cloud's top. */
const BED = -0.7;
const BANK = 0.45;
const CLOUD = -12;

/** A place in meters. */
type Place = [x: number, y: number, z: number];

/** Each view's camera place and the point that it looks at. */
const VIEWS: Record<'high' | 'near' | 'side' | 'profile', readonly [Place, Place]> = {
	high: [
		[16, 10, 14],
		[0, -7, 0],
	],
	near: [
		[8, -2, 6],
		[1.5, -5, 0],
	],
	side: [
		[2, -5, 32],
		[2, -5, 0],
	],
	// In profile from above, as the concept's camera sees its left fall: along the cliff's face,
	// looking down at about 25 degrees.
	profile: [
		[1, 9, 34],
		[1, -5, 4],
	],
};
const SWITCHES = new URL(import.meta.url).searchParams;
const VIEW = VIEWS[(SWITCHES.get('view') ?? 'high') as keyof typeof VIEWS] ?? VIEWS.high;
/** The spray and mist, as a factor of the fall's own. */
const SPRAY = Number(SWITCHES.get('spray') ?? 1);

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials } = ctx;
	// Overcast: a grey sky, a soft light from high above and the sky's grey light all round.
	scene.setBackground('#c2c2cc');
	scene.setFog({ color: '#b9b8c2', density: 0.01, height: CLOUD, heightFalloff: 0.4 });
	scene.createDirectionalLight({ direction: [-0.4, -0.85, -0.3], intensity: 2.2 });
	scene.createHemisphereLight({ skyColor: '#d4d3dc', groundColor: '#3a3833', intensity: 2.6 });
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 400,
		position: [...VIEW[0]],
		target: [...VIEW[1]],
	});
	scene.setActiveCamera(camera);
	// The cliff: a block whose face drops straight below the lip, the creek's rock bed on its top,
	// a bank on each side of the creek, and the top of the cloud sea below the rim.
	const rock = materials.standard({ color: '#2b2a27', roughness: 0.95 });
	const moss = materials.standard({ color: '#4f5a2c', roughness: 1 });
	scene.createMesh({
		mesh: geometry.box({ width: 40, height: 40, depth: 40 }),
		material: rock,
		position: [-20, BED - 20, 0],
	});
	for (const side of [-1, 1])
		scene.createMesh({
			mesh: geometry.box({ width: 40, height: BANK - BED, depth: 17 }),
			material: moss,
			position: [-20, (BANK + BED) / 2, side * (HALF + 8.5)],
		});
	scene.createMesh({
		mesh: geometry.box({ width: 400, height: 1, depth: 400 }),
		material: materials.standard({ color: '#9c9ba6', roughness: 1 }),
		position: [0, CLOUD - 0.5, 0],
	});
	// The creek runs along +x and ends at the lip, where the fall takes over.
	const water = createWater(ctx, {
		shapes: {
			kind: 'river',
			middle: [
				[-40, 0],
				[0, 0],
			],
			halfWidth: HALF,
			depth: -BED,
			speed: SPEED,
		},
		waveAmplitude: 0.2,
		material: { attenuationColor: '#8a948f' },
	});
	const fall = await createWaterfall(ctx, {
		lip: [0, 0],
		direction: [1, 0],
		// The garden's falls are a little narrower than the creek, and widen a little as they fall.
		halfWidth: HALF * 0.85,
		speed: SPEED,
		drop: DROP,
		spread: 0.16,
		// The cloud draws before the fall, so the fall vanishes itself where it sinks into it.
		fadeBelow: CLOUD,
		spray: SPRAY,
	});
	fall.setLight([0.8, 0.8, 0.84]);
	return {
		onUpdate() {
			water.update();
		},
		onLateUpdate() {
			fall.update();
		},
	};
});
