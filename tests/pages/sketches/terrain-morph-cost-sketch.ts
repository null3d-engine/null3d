// A terrain for the page that measures what the block morph costs in a frame
// (tests/pages/terrain-morph-cost.ts): a valley of the terrain add-on, its quadtree following a
// camera that circles it. The page's messages turn the morph on and off with `terrain.setMorph`, so
// both sides draw the same blocks, the same triangles and the same pixels, and differ only in the
// vertex offset that moves each block toward its parent's surface.
import { defineSketch } from '@null3d/engine';
import { createTerrain, terrainTextures } from '@null3d/terrain';

/** The ground's side and the camera's circle, in meters. */
const SIZE = 800;
const ORBIT = 170;
const EYE = 70;

const hash = (x: number, y: number) => {
	let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise, from -1 to 1. */
function noise(x: number, y: number): number {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const u = smooth(x - xi);
	const v = smooth(y - yi);
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	return (
		lerp(
			lerp(hash(xi, yi), hash(xi + 1, yi), u),
			lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u),
			v,
		) *
			2 -
		1
	);
}

/** Octaves of noise, each twice as fine and half as strong. */
function fbm(x: number, y: number, octaves: number): number {
	let sum = 0;
	let amplitude = 0.5;
	let scale = 1;
	for (let o = 0; o < octaves; o++) {
		sum += amplitude * noise(x * scale, y * scale);
		amplitude *= 0.5;
		scale *= 2;
	}
	return sum;
}

/** Rolling hills with a valley along z, and small folds that a far block's cells span. */
function ground(x: number, z: number): number {
	const hills = 40 * fbm(x * 0.004, z * 0.004, 4) + 4 * fbm(x * 0.02, z * 0.02, 2);
	const valley = -20 * Math.exp(-(z * z) / (2 * 180 * 180));
	return hills + valley + 8;
}

export default defineSketch((ctx) => {
	const { scene, textures, page, time } = ctx;
	scene.setBackground('#8fb4d8');
	scene.createDirectionalLight({ direction: [-0.5, -1, -0.4], intensity: 3, castShadows: true });
	scene.createAmbientLight({ intensity: 0.5 });
	const camera = scene.createPerspectiveCamera({ fov: 52, near: 1, far: 2000 });
	scene.setActiveCamera(camera);

	const layers = terrainTextures(textures, { size: 64, seed: 4 });
	const terrain = createTerrain(ctx, {
		size: SIZE,
		height: ground,
		resolution: 256,
		layers: [
			{ map: layers.grass, tile: 6, heightFrom: 'alpha' },
			{ map: layers.soil, tile: 10, heightFrom: 'alpha' },
			{ map: layers.rock, tile: 7, roughness: 0.85, heightFrom: 'alpha' },
			{ map: layers.snow, tile: 12, roughness: 0.7, heightFrom: 'alpha' },
		],
		maxLevel: 6,
		camera,
	});
	page.onMessage((name) => {
		terrain.setMorph(name === 'morph');
		page.post('settled');
	});

	// One array, kept, so a frame allocates nothing for the camera's place.
	const eye = new Float64Array(3);
	return {
		onUpdate() {
			const t = time.now * 0.12;
			eye[0] = Math.cos(t) * ORBIT;
			eye[1] = EYE;
			eye[2] = Math.sin(t) * ORBIT;
			camera.setPosition(eye[0], eye[1], eye[2]);
			camera.lookAt(0, 4, 0);
			terrain.update(eye);
		},
	};
});
