// A city for software occlusion culling: 8 x 8 blocks of buildings that block the view, 3,000
// spheres and a static batch of 20,000 small boxes along the streets, and a camera at eye height
// that flies down one street and turns its head. From the street, the buildings hide most of the
// city. The image tests draw it with occlusion culling on and off, which must give one image; the
// occlusion cost page times it. ?fixed holds the render scale at 1 with the governor off, for
// timing. The page's 'occlusion-on' and 'occlusion-off' messages turn the culling on and off, and
// the sketch answers each with 'occlusion' once the next frame has the new setting. ?light keeps a
// tenth of the spheres and boxes, which a software GPU draws in time for the image tests.
import { defineSketch } from '@null3d/engine';

/** Blocks along each side, the distance between their centers, and each building's footprint. */
const BLOCKS = 8;
const SPACING = 30;
const FOOTPRINT = 20;
const params = new URL(import.meta.url).searchParams;
const FIXED = params.has('fixed');
/** Spheres and boxes along the streets. */
const SHARE = params.has('light') ? 0.1 : 1;
const SPHERES = 3000 * SHARE;
const BOXES = 20_000 * SHARE;
/** Where the first block's center lies on each axis. */
const FIRST = -((BLOCKS - 1) * SPACING) / 2;
/** The street that the camera flies down, along +x, and the camera's speed in meters per second. */
const STREET_Z = FIRST + SPACING * 3.5;
const SPEED = 12;

/** A small seeded random generator, so every run builds the same city. */
function random(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A point on a random street, with x, z and a sideways offset of up to 4 m. */
function onStreet(next: () => number): [number, number] {
	const street = FIRST - SPACING / 2 + SPACING * Math.floor(next() * (BLOCKS + 1));
	const along = (next() - 0.5) * BLOCKS * SPACING;
	const side = (next() - 0.5) * 8;
	return next() < 0.5 ? [street + side, along] : [along, street + side];
}

export default defineSketch(({ scene, geometry, materials, quality, time, page }) => {
	if (FIXED) quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	scene.setBackground('#9fb7cc');
	const camera = scene.createPerspectiveCamera({ fov: 70, near: 0.2, far: 600 });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.6, -1, -0.3], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.5 });
	const next = random(36);

	const side = BLOCKS * SPACING;
	scene.createMesh({
		mesh: geometry.box({ width: side, height: 1, depth: side }),
		material: materials.standard({ color: '#59616b' }),
		position: [0, -0.5, 0],
	});
	const walls = [
		materials.standard({ color: '#c9b79c' }),
		materials.standard({ color: '#8f9ba8' }),
		materials.standard({ color: '#b07d62' }),
	];
	const building = geometry.box({ width: FOOTPRINT, height: 1, depth: FOOTPRINT });
	for (let i = 0; i < BLOCKS; i++)
		for (let j = 0; j < BLOCKS; j++) {
			const height = 12 + next() * 48;
			scene.createMesh({
				mesh: building,
				material: walls[(i + j) % walls.length] as (typeof walls)[number],
				position: [FIRST + i * SPACING, height / 2, FIRST + j * SPACING],
				scale: [1, height, 1],
				occluder: true,
			});
		}

	const ball = geometry.sphere({ radius: 0.5, widthSegments: 12, heightSegments: 8 });
	const balls = [
		materials.standard({ color: '#e8554e' }),
		materials.standard({ color: '#f2c14e' }),
	];
	for (let k = 0; k < SPHERES; k++) {
		const [x, z] = onStreet(next);
		scene.createMesh({
			mesh: ball,
			material: balls[k % balls.length] as (typeof balls)[number],
			position: [x, 0.5, z],
		});
	}
	const crates = scene.createInstances(geometry.box(), BOXES, {
		material: materials.standard({ color: '#4a8cff' }),
	});
	for (let k = 0; k < BOXES; k++) {
		const [x, z] = onStreet(next);
		const size = 0.15 + next() * 0.3;
		crates.positions.set([x, size / 2, z], k * 3);
		crates.scales.set([size, size, size], k * 3);
	}
	crates.markDirty();

	let answer = false;
	page.onMessage((name) => {
		if (name !== 'occlusion-on' && name !== 'occlusion-off') return;
		quality.set({ softwareOcclusion: name === 'occlusion-on' });
		answer = true;
	});
	return {
		onUpdate() {
			const t = time.now;
			const x = -side / 2 + ((t * SPEED) % side);
			const look = Math.sin(t * 0.7) * 0.6;
			camera.setPosition(x, 2, STREET_Z);
			camera.lookAt(x + Math.cos(look) * 10, 2, STREET_Z + Math.sin(look) * 10);
			if (answer) {
				answer = false;
				page.post('occlusion', time.frame);
			}
		},
	};
});
