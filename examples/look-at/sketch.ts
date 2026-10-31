// Joint overrides: seven knights stand in a ring in a castle courtyard at dusk and watch a wisp of
// light. Each knight plays its idle or its guard clip at a time of its own, and a look-at turns its
// spine, chest and head toward the wisp on top of the clip. Each joint stops at its limit, so the
// head turns further than the body, and a knight with the wisp behind it looks over its shoulder.
// The engine aims on its job workers, so the sketch moves only the wisp. The pointer leads the
// wisp; without it, the wisp drifts over the ring.
import { defineSketch, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { sampleUrl } from '../lib/samples';
import { courtyard, flicker } from './courtyard';

/** The Knight's accessories that it leaves behind: it carries one sword and one round shield. */
const HIDDEN = ['1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield'];
const KNIGHTS = 7;
/** The ring's radius, in meters. */
const RING = 3;
/** Spine, chest and head share the turn, and the head takes half of it, up to its own limit. */
const LOOK = Object.freeze({
	joints: ['spine', 'chest', 'head'],
	limit: [0.35, 0.45, 1.1],
	shares: [1, 1, 2],
});
/** The point that the camera looks at, and the box that the pointer leads the wisp in. */
const TARGET = [0, 1.1, 0] as const;
const BOUNDS = [-5, 0.4, -5, 5, 3, 5] as const;
const GOLD = '#ffc46b';

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	// Dusk: the sun sits low behind the walls, the sky's blue fills the yard, and the torches and
	// the wisp's warm light pick out the knights.
	const day = timeOfDay(19.1, { heading: 2.6 });
	const sky = { intensity: day.skyIntensity };
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.35 } }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), sky);
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 25 } });
	scene.createHemisphereLight({ skyColor: '#8fa6d6', groundColor: '#5a4632', intensity: 0.8 });
	scene.setFog({
		color: day.fog.color,
		density: 0.008,
		heightFalloff: 0.4,
		sunGlow: day.fog.sunGlow,
	});
	post.set({
		exposure: day.exposure,
		bloom: { intensity: 0.35, threshold: 1 },
		ao: { radius: 0.4 },
		vignette: {},
	});

	const camera = scene.createPerspectiveCamera({ fov: 45, far: 500, position: [0, 7.2, 11.5] });
	camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
	scene.setActiveCamera(camera);
	const limits = { maxPolarAngle: Math.PI * 0.42, minDistance: 4, maxDistance: 18 };
	const view = interact(ctx, camera, { target: TARGET, ...limits, groundY: 1.4, bounds: BOUNDS });
	// A second view close to the ring, on a knight's face, so the head that the look-at turns shows
	// where the wide camera cannot see it. Its rectangle is the canvas's top-right corner.
	const close = scene.createPerspectiveCamera({
		fov: 50,
		position: [0.05, 1.6, 1.15],
		target: [0.6, 1.55, 2.9],
	});
	scene.createView({ camera: close, rect: [0.69, 0.02, 0.29, 0.32] });

	// The courtyard, and a round dais of worn stone in its middle where the knights stand.
	const torches = courtyard(ctx);
	const granite = materials.standard({ color: '#8d877d', roughness: 0.85 });
	const dais = geometry.cylinder({ radiusTop: RING + 0.9, radiusBottom: RING + 1.1, height: 0.2 });
	scene.createMesh({
		mesh: dais,
		material: granite,
		position: [0, 0.15, 0],
		castShadows: true,
		receiveShadows: true,
	});

	// The wisp: a small sun of its own, whose light bloom spreads, and that casts the knights'
	// shadows on the dais on High.
	const glow = materials.standard({ color: '#000000', emissive: GOLD, emissiveIntensity: 20 });
	const wisp = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.09 }),
		material: glow,
		dynamic: true,
	});
	scene.createPointLight({
		parent: wisp,
		color: GOLD,
		intensity: 30,
		range: 12,
		castShadows: true,
	});

	// The knights face the middle of the ring. The guards raise their shields, the others idle.
	const knight = await assets.loadGltf(sampleUrl('sources/characters/kaykit-knight/Knight.glb'));
	const place = vec3.create();
	const animators = Array.from({ length: KNIGHTS }, (_, k) => {
		const angle = (k / KNIGHTS) * Math.PI * 2 + 0.2;
		const copy = scene.instantiate(knight, {
			position: [Math.sin(angle) * RING, 0.25, Math.cos(angle) * RING],
			castShadows: true,
		});
		copy.setRotationEuler(0, angle + Math.PI, 0);
		for (const name of HIDDEN) copy.find(name)?.setVisible(false);
		const animator = copy.animator();
		animator.play(k % 3 === 1 ? 'Blocking' : 'Idle', { time: k * 0.37 });
		animator.lookAt(place, LOOK);
		return animator;
	});

	return {
		onUpdate(dt) {
			// The wisp drifts over the ring on a path that time alone sets, so a held frame shows
			// what the live demo shows at that time. The pointer takes it over.
			const t = time.now;
			flicker(torches, t);
			vec3.set(
				place,
				2.4 * Math.sin(0.45 * t),
				1.5 + 0.6 * Math.sin(1.1 * t),
				2.1 * Math.sin(0.7 * t + 1),
			);
			view.update(dt);
			vec3.lerp(place, place, view.point, view.steering);
			wisp.setPosition(place[0], place[1], place[2]);
			for (const animator of animators) animator.lookAt(place);
		},
	};
});
