// Contact shadows: small objects on the ground under a low sun, a few meters from the camera, where
// the cascades' texels and biases leave a lit line or no shadow at all. Pebbles a few centimeters
// high, a thin pole, a crate and an upright tyre stand on a plane that receives shadows. The shadow
// map is small, so its texels are coarse, as a far cascade's are.
//
// ?off turns contact shadows off for the light, ?ao turns ambient occlusion on as well, so its last
// step marches them, and ?steps= sets the steps of each march: 8 by default, as on High. ?reach=
// sets how far they reach, in meters. ?opted-out gives every material `contactShadows: false`, so no
// surface takes the contact shadows that the light still draws, and the frame matches ?off.
//
// The effect cost page passes ?fixed and ?scale=: the scene then draws at that render scale alone,
// with the governor off, and starts with contact shadows off. On the page's 'contact' message it
// turns them on, waits until their pipelines are built, and posts 'settled'. The 'contact-off'
// message turns them off again. Off and on, the depth prepass follows them on WebGPU, so the cost
// counts it.
//
// The module uses no type annotations: an address whose last value holds a dot, such as reach=0.6,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const OFF = params.has('off');
const AO = params.has('ao');
const STEPS = Number(params.get('steps') ?? 8);
const REACH = Number(params.get('reach') ?? 0.3);
const FIXED = params.has('fixed');
const SCALE = Number(params.get('scale') ?? 1);
/** The materials' own switch for contact shadows. */
const OWN = { contactShadows: !params.has('opted-out') };

/** The pebbles: their place on the ground, their radius and how flat they are, in meters. */
const PEBBLES: readonly (readonly [number, number, number, number])[] = [
	[-0.9, 0.3, 0.07, 0.5],
	[-0.6, 0.55, 0.05, 0.6],
	[-0.75, 0.05, 0.04, 0.45],
	[-0.4, 0.25, 0.09, 0.4],
	[-1.15, 0.6, 0.06, 0.55],
	[-0.2, 0.7, 0.03, 0.7],
	[-1.3, 0.15, 0.05, 0.5],
];

export default defineSketch(({ scene, materials, geometry, quality, post, page }) => {
	const steps = STEPS === 4 ? 4 : STEPS === 16 ? 16 : 8;
	quality.set({ governor: false, contactShadowSteps: FIXED ? 0 : steps, aoScale: 0.5 });
	if (FIXED) quality.set({ minRenderScale: SCALE, maxRenderScale: SCALE });
	page.onMessage((message) => {
		if (message === 'contact-off') quality.set({ contactShadowSteps: 0 });
		if (message !== 'contact') return;
		quality.set({ contactShadowSteps: steps });
		void scene.warmUp().then(() => page.post('settled', null));
	});
	if (AO) post.set({ ao: { radius: 0.3 } });
	scene.setBackground('#9fb4c8');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			position: [0.4, 1.3, 3.2],
			target: [-0.3, 0.15, 0.2],
			near: 0.1,
			far: 100,
		}),
	);
	scene.createDirectionalLight({
		direction: [0.75, -0.45, -0.5],
		color: '#fff1dc',
		intensity: 3,
		castShadows: true,
		shadow: { cascades: 2, mapSize: 512, distance: 40, contactDistance: OFF ? 0 : REACH },
	});
	scene.createAmbientLight({ color: '#c8d8ff', intensity: 0.5 });

	const ground = materials.standard({ color: '#c9b79a', roughness: 0.95, ...OWN });
	scene.createMesh({
		mesh: geometry.box({ width: 20, height: 0.2, depth: 20 }),
		material: ground,
		position: [0, -0.1, 0],
		receiveShadows: true,
	});
	const solid = { castShadows: true, receiveShadows: true };
	const stone = materials.standard({ color: '#8a8580', roughness: 0.8, ...OWN });
	const sphere = geometry.sphere({ radius: 1, widthSegments: 16, heightSegments: 12 });
	for (const [x, z, radius, flat] of PEBBLES)
		scene.createMesh({
			mesh: sphere,
			material: stone,
			position: [x, radius * flat * 0.8, z],
			scale: [radius, radius * flat, radius * 1.2],
			...solid,
		});
	// A thin pole, a crate and an upright tyre.
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 0.02, radiusBottom: 0.02, height: 1.2 }),
		material: materials.standard({ color: '#d0d0d0', metalness: 1, roughness: 0.4, ...OWN }),
		position: [0.3, 0.6, -0.3],
		...solid,
	});
	scene.createMesh({
		mesh: geometry.box({ width: 0.4, height: 0.4, depth: 0.4 }),
		material: materials.standard({ color: '#a8743f', roughness: 0.7, ...OWN }),
		position: [0.55, 0.2, 0.55],
		rotation: [0, 0.2588, 0, 0.9659],
		...solid,
	});
	scene.createMesh({
		mesh: geometry.torus({ radius: 0.25, tube: 0.09 }),
		material: materials.standard({ color: '#222222', roughness: 0.6, ...OWN }),
		position: [-0.2, 0.34, -0.5],
		rotation: [0, 0.3827, 0, 0.9239],
		...solid,
	});
});
