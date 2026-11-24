// The sound add-on's own page, which the listing check opens. A glowing sphere circles the listener
// and hums, and a swarm of small spheres buzzes around it, more of them than the swarm has voices,
// so the nearest few sound at once. The page hands the sketch the two sounds' files after it starts,
// so the sketch makes its sounds late, as a sketch that loads its files first does.
import { defineSketch, type Mesh } from '@null3d/engine';
import { createSound, type SoundGroup, type SoundLoop } from '../src/index.ts';

/** The swarm: how many, and the voices that sound at once. */
const BEES = 12;
const BEE_VOICES = 4;
/** The humming sphere's distance from the listener, and the seconds of one lap. */
const ORBIT = 5;
const LAP = 8;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, page, time } = ctx;
	const camera = scene.createPerspectiveCamera({
		fov: 70,
		position: [0, 1.6, 0],
		target: [0, 1.4, -4],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 2 });
	scene.createAmbientLight({ intensity: 0.4 });
	scene.createMesh({
		mesh: geometry.plane({ width: 60, height: 60 }),
		material: materials.standard({ color: '#2a2d33', roughness: 0.6 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	const glow = materials.standard({ color: '#000000', emissive: '#ffb36b', emissiveIntensity: 8 });
	const hummer = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.35 }),
		material: glow,
		dynamic: true,
	});
	const beeLook = materials.standard({
		color: '#000000',
		emissive: '#7fd0ff',
		emissiveIntensity: 6,
	});
	const beeShape = geometry.sphere({ radius: 0.12 });
	const bees: Mesh[] = [];
	for (let i = 0; i < BEES; i++)
		bees.push(scene.createMesh({ mesh: beeShape, material: beeLook, dynamic: true }));

	const sound = createSound(ctx, { listener: camera });
	let hum: SoundLoop | undefined;
	let swarm: SoundGroup | undefined;
	page.onMessage((type, data) => {
		if (type !== 'files' || hum) return;
		const files = data as { hum: string; buzz: string };
		hum = sound.loop({ file: files.hum, near: 2, far: 40 });
		swarm = sound.group({ file: files.buzz, count: BEES, voices: BEE_VOICES, near: 1, far: 20 });
	});

	return {
		onUpdate() {
			const t = time.now;
			const turn = (t / LAP) * Math.PI * 2;
			const hx = Math.sin(turn) * ORBIT;
			const hz = -Math.cos(turn) * ORBIT;
			hummer.setPosition(hx, 1.5, hz);
			hum?.setPosition(hx, 1.5, hz);
			for (let i = 0; i < BEES; i++) {
				// Each bee keeps a ring of its own and drifts up and down on it.
				const ring = 2.5 + i * 0.7;
				const angle = -t * (0.3 + 0.05 * i) + i * 1.7;
				const x = Math.sin(angle) * ring;
				const y = 1.2 + 0.6 * Math.sin(t * 1.3 + i);
				const z = -Math.cos(angle) * ring;
				(bees[i] as Mesh).setPosition(x, y, z);
				swarm?.setPosition(i, x, y, z);
			}
		},
		onLateUpdate() {
			sound.update();
		},
	};
});
