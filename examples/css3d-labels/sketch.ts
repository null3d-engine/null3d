// 3D labels: nine monoliths stand in a ring that turns in a dark hall, each with an HTML card that
// turns and scales with it, and a title above the ring that always faces the camera. The cards are
// planes of the scene: `ui.trackLabel`'s 'world' and 'billboard' transforms place their elements in
// the camera's own perspective, as three.js's `CSS3DRenderer` does, so a card leans away as the
// ring turns and the title stays square to the view. The world is measured in CSS pixels, which are
// the units of an element's own size, so a card 168 pixels wide is 168 units wide.
import { defineSketch, quat, type Vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The stations' number, the ring's radius in world units, and the camera's orbit. */
const STATIONS = 9;
const RING = 320;
const ORBIT = 900;
const EYE = 230;
/** The height that the camera and the ring's centre look at, in world units. */
const AIM = 60;
/** The card's size in CSS pixels, which are the scene's units, and where it sits over its monolith. */
const CARD: [number, number] = [140, 150];
const CARD_OFFSET: Vec3 = [0, 165, 8];
const NAMES = ['Aurora', 'Basalt', 'Cinder', 'Delta', 'Ember', 'Fathom', 'Glass', 'Harbor', 'Iris'];
/** The colors of the monoliths' strips, one for each station around the ring. */
const TONES = [
	'#e05151',
	'#e0b051',
	'#b0e051',
	'#51e051',
	'#51e0b0',
	'#51b0e0',
	'#5151e0',
	'#b051e0',
	'#e051b0',
];
/** What the title above the ring says. */
const TITLE = 'CSS3D';

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, ui, page, time } = ctx;
	scene.setBackground('#06080c');
	scene.setFog({ color: '#06080c', density: 0.0004 });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 1.1 });
	scene.createDirectionalLight({
		direction: [-0.55, -1, -0.45],
		color: '#ffe3c2',
		intensity: 3.4,
		castShadows: true,
		shadow: { distance: 1200 },
	});
	// A cool light from the far side picks out the ring's far half.
	scene.createDirectionalLight({ direction: [0.6, -0.4, 0.7], color: '#9dc4ff', intensity: 1.2 });
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 5,
		far: 6000,
		position: [0, EYE, ORBIT],
		target: [0, AIM, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, AIM, 0], maxPolarAngle: Math.PI * 0.48 });

	// A dark floor, which the monoliths cast their shadows on.
	scene.createMesh({
		mesh: geometry.plane({ width: 6000, height: 6000 }),
		material: materials.standard({ color: '#1c2531', roughness: 0.5, metalness: 0.2 }),
		position: [0, -48, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	const slab = geometry.box();
	const strip = geometry.box();
	const ring = scene.createGroup({ dynamic: true });
	for (let i = 0; i < STATIONS; i++) {
		const angle = (i / STATIONS) * Math.PI * 2;
		// Each monolith faces out of the ring, so its card turns away from the camera as the ring turns.
		const station = scene.createGroup({
			parent: ring,
			position: [Math.sin(angle) * RING, 36, Math.cos(angle) * RING],
			rotation: quat.fromEuler(quat.create(), 0, angle, 0),
		});
		const tone = TONES[i] as string;
		scene.createMesh({
			parent: station,
			mesh: slab,
			material: materials.standard({ color: '#35425c', roughness: 0.3, metalness: 0.55 }),
			scale: [96, 168, 14] as Vec3,
			castShadows: true,
			receiveShadows: true,
		});
		scene.createMesh({
			parent: station,
			mesh: strip,
			material: materials.standard({ emissive: tone, emissiveIntensity: 5 }),
			position: [0, 74, 8],
			scale: [72, 6, 3] as Vec3,
		});
		// The card is a plane of the scene at the top of its monolith, turned with the station.
		ui.trackLabel(station, `card-${i}`, { transform: 'world', offset: CARD_OFFSET });
		page.post('label', {
			id: `card-${i}`,
			text: `${String(i + 1).padStart(2, '0')} · ${NAMES[i]}`,
			width: CARD[0],
			height: CARD[1],
		});
	}

	// The title is a plane too, but it always faces the camera, so it never turns edge-on.
	const crown = scene.createGroup({ position: [0, 300, 0] });
	ui.trackLabel(crown, 'title', { transform: 'billboard' });
	page.post('label', { id: 'title', text: TITLE, width: 320, height: 96, active: true });

	return {
		onUpdate(dt) {
			// The sketch's clock, not a sum of steps, so a held frame is the same on every machine.
			const turn = time.now * 0.16;
			ring.setRotationEuler(0, turn, 0);
			// The camera circles the ring until the user takes it with a drag or the wheel.
			if (!view.userCamera) {
				camera.setPosition(Math.sin(turn * 0.6) * ORBIT, EYE, Math.cos(turn * 0.6) * ORBIT);
				camera.lookAt(0, AIM, 0);
			}
			view.update(dt);
		},
	};
});
