// Joint overrides: seven knights stand in a ring of standing stones at dusk and watch a wisp of
// light. Each knight plays its idle or its guard clip at a time of its own, and a look-at turns its
// spine, chest and head toward the wisp on top of the clip. Each joint stops at its limit, so the
// head turns further than the body, and a knight with the wisp behind it looks over its shoulder.
// The engine aims on its job workers, so the sketch moves only the wisp. The pointer leads the
// wisp; without it, the wisp drifts over the ring.
import { defineSketch, math, quat, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { sampleUrl } from '../lib/samples';

/** The Knight's accessories that it leaves behind: it carries one sword and one round shield. */
const HIDDEN = ['1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield'];
const KNIGHTS = 7;
/** The ring's radius, in meters, and the standing stones' ring outside it. */
const RING = 3;
const STONES = 9;
/** Spine, chest and head share the turn, and the head takes half of it, up to its own limit. */
const LOOK = Object.freeze({
	joints: ['spine', 'chest', 'head'],
	limit: [0.35, 0.45, 1.1],
	shares: [1, 1, 2],
});
/** The point that the camera looks at, and the box that the pointer leads the wisp in. */
const TARGET = [0, 1.1, 0] as const;
const BOUNDS = [-4.5, 0.4, -4.5, 4.5, 3, 4.5] as const;
const GOLD = '#ffc46b';

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	// Dusk: the sun sits low behind the stones, and the wisp's warm light picks out the knights.
	const day = timeOfDay(19.1, { heading: 2.6 });
	const sky = { intensity: day.skyIntensity };
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.35 } }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), sky);
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 25 } });
	scene.setFog({
		color: day.fog.color,
		density: 0.02,
		heightFalloff: 0.4,
		sunGlow: day.fog.sunGlow,
	});
	post.set({
		exposure: day.exposure,
		bloom: { intensity: 0.35, threshold: 1 },
		ao: { radius: 0.4 },
		vignette: {},
	});

	const camera = scene.createPerspectiveCamera({ fov: 45, far: 500, position: [0, 3.4, 8.6] });
	camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
	scene.setActiveCamera(camera);
	const limits = { maxPolarAngle: Math.PI * 0.47, minDistance: 3, maxDistance: 18 };
	const view = interact(ctx, camera, { target: TARGET, ...limits, groundY: 1.4, bounds: BOUNDS });

	// Moss over the hill, a round dais of worn stone, and a ring of standing stones.
	const solid = { castShadows: true, receiveShadows: true };
	const moss = materials.standard({ color: '#3f4a2a', roughness: 0.95, doubleSided: true });
	scene.createMesh({
		mesh: geometry.circle({ radius: 80, segments: 64 }),
		material: moss,
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	const granite = materials.standard({ color: '#8d877d', roughness: 0.85 });
	const dais = geometry.cylinder({ radiusTop: RING + 0.9, radiusBottom: RING + 1.1, height: 0.2 });
	scene.createMesh({ mesh: dais, material: granite, position: [0, 0.1, 0], ...solid });
	math.seed(11);
	const slab = geometry.box();
	for (let k = 0; k < STONES; k++) {
		const angle = ((k + 0.5) / STONES) * Math.PI * 2;
		const [height, lean] = [math.randFloat(1.4, 2.4), math.randFloat(-0.08, 0.08)];
		scene.createMesh({
			mesh: slab,
			material: granite,
			position: [Math.sin(angle) * 6.5, height / 2 - 0.1, Math.cos(angle) * 6.5],
			rotation: quat.fromEuler(quat.create(), lean, angle, 0, 'YXZ'),
			scale: [0.9, height, 0.45],
			...solid,
		});
	}

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
			position: [Math.sin(angle) * RING, 0.2, Math.cos(angle) * RING],
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
