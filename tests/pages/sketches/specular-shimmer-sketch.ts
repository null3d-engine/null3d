// Shiny metal that flickers as the camera moves, for the specular shimmer page. The module's
// address picks a scene with ?scene=:
// - `small` (the default): rows of small spheres and thin rings of few triangles, each 10 to 20
//   pixels across, with roughness from 0.1 to 0.4. Their normals turn fast between pixels, and
//   jump from one triangle to the next.
// - `smooth`: a grid of large spheres of many triangles, 40 to 60 pixels across, with roughness
//   from 0.05 to 0.3. Their normals turn smoothly.
// - `bumps`: a large metal sphere with roughness 0.2 under a fine normal map of bumps, whose
//   detail no change of the mesh's own normal shows.
// A sun lights each scene. The camera orbits slowly: the page sends a time in its 'at' message,
// and the sketch places the camera there and answers 'placed'. So the page steps the camera
// exactly, frame by frame.
import { defineSketch, type SketchContext } from '@null3d/engine';

/** The camera's turn about the scene, in radians per second of sketch time. */
export const ORBIT_SPEED = 0.01;
/** The scenes that ?scene= names. */
export const SHIMMER_SCENES = ['small', 'smooth', 'bumps'] as const;
export type ShimmerScene = (typeof SHIMMER_SCENES)[number];

const params = new URL(import.meta.url).searchParams;
const SCENE = (params.get('scene') ?? 'small') as ShimmerScene;

/** Texels on each side of the bumps' normal map, and bumps along each side. */
const BUMP_TEXELS = 256;
const BUMPS = 16;

/** Rows of small spheres and rings of few triangles. */
function small({ scene, materials, geometry }: SketchContext): void {
	const columns = 16;
	const rows = 6;
	const sphere = geometry.sphere({ radius: 0.3, widthSegments: 32, heightSegments: 16 });
	const ring = geometry.torus({
		radius: 0.28,
		tube: 0.05,
		radialSegments: 12,
		tubularSegments: 48,
	});
	for (let column = 0; column < columns; column++) {
		const roughness = 0.1 + (0.3 * column) / (columns - 1);
		const material = materials.standard({ color: '#d8c8a8', metalness: 1, roughness });
		for (let row = 0; row < rows; row++)
			scene
				.createMesh({
					mesh: row % 2 === 0 ? sphere : ring,
					material,
					position: [(column - (columns - 1) / 2) * 0.8, (row - (rows - 1) / 2) * 0.8, 0],
				})
				.setRotationEuler(0.7 * row, 0.3 * column, 0);
	}
}

/** A grid of large spheres of many triangles. */
function smooth({ scene, materials, geometry }: SketchContext): void {
	const columns = 6;
	const rows = 3;
	const sphere = geometry.sphere({ radius: 0.8, widthSegments: 128, heightSegments: 64 });
	for (let column = 0; column < columns; column++) {
		const roughness = 0.05 + (0.25 * column) / (columns - 1);
		const material = materials.standard({ color: '#d8c8a8', metalness: 1, roughness });
		for (let row = 0; row < rows; row++)
			scene.createMesh({
				mesh: sphere,
				material,
				position: [(column - (columns - 1) / 2) * 2, (row - (rows - 1) / 2) * 2, 0],
			});
	}
}

/**
 * A normal map of round bumps in tangent space, BUMPS along each side, as linear RGBA8 texels
 * from the bottom row up.
 */
function bumpTexels(): Uint8Array {
	const data = new Uint8Array(BUMP_TEXELS * BUMP_TEXELS * 4);
	const cell = BUMP_TEXELS / BUMPS;
	for (let y = 0; y < BUMP_TEXELS; y++)
		for (let x = 0; x < BUMP_TEXELS; x++) {
			// Each cell holds a dome, whose slope tilts the normal away from the cell's center.
			const u = ((x + 0.5) % cell) / cell - 0.5;
			const v = ((y + 0.5) % cell) / cell - 0.5;
			const slope = 1.6;
			const nx = -u * slope;
			const ny = -v * slope;
			const length = Math.hypot(nx, ny, 1);
			const at = 4 * (y * BUMP_TEXELS + x);
			data[at] = Math.round(((nx / length) * 0.5 + 0.5) * 255);
			data[at + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255);
			data[at + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
			data[at + 3] = 255;
		}
	return data;
}

/** A large metal sphere under a fine normal map of bumps. */
function bumps({ scene, materials, geometry, textures }: SketchContext): void {
	const normalMap = textures.fromData({
		width: BUMP_TEXELS,
		height: BUMP_TEXELS,
		data: bumpTexels(),
		colorSpace: 'linear',
		wrap: 'repeat',
		mipmaps: true,
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 3, widthSegments: 128, heightSegments: 64 }),
		material: materials.standard({
			color: '#d8c8a8',
			metalness: 1,
			roughness: 0.2,
			normalMap,
			uvTransform: { repeat: [8, 4] },
		}),
	});
}

export default defineSketch((context) => {
	const { scene, quality, page } = context;
	quality.set({ minRenderScale: 1, governor: false });
	scene.setBackground('#05070a');
	scene.createDirectionalLight({ direction: [-0.4, -0.35, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.05 });
	const camera = scene.createPerspectiveCamera({ fov: 30, near: 0.5, far: 200 });
	scene.setActiveCamera(camera);
	({ small, smooth, bumps })[SCENE](context);
	const orbit = (seconds: number) => {
		const angle = 0.2 + seconds * ORBIT_SPEED;
		camera.setPosition(Math.sin(angle) * 16, 1.2, Math.cos(angle) * 16);
		camera.lookAt(0, 0, 0);
	};
	orbit(0);
	page.onMessage((name, seconds) => {
		if (name !== 'at') return;
		orbit(seconds as number);
		page.post('placed');
	});
});
