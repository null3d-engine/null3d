// The curtain of lit quads for the page that measures what a directional light map costs
// (tests/pages/lightmap-cost.ts): a grid of quads fills the view once, with no overlap, so every
// screen pixel shades one fragment whichever material draws it. Each quad reads a normal map, so the
// normal turns per pixel, and a light map. The page's messages swap every quad between the plain
// light map's build of the standard material and the directional one, which reads a second texture
// of the bake's own size and bends the baked light with the normal. The two builds shade the same
// pixels with the same radiance, so their difference is the direction's read and its arithmetic.
// The depth prepass stays off, so no quad is skipped by a depth already in the target, and the
// governor stays off, so the render scale holds.
import { defineSketch, type Material, type Mesh, type Texture } from '@null3d/engine';

/** The quads across and down the view, and the view's height in world units. */
const COLUMNS = 6;
const ROWS = 4;
const VIEW_HEIGHT = 2;
/** The view's width that the grid covers, in world units: more than a 16:9 window shows. */
const GRID_WIDTH = 4.8;
/** The texels along each edge of a map. */
const MAP_SIZE = 256;
/** The cells along each edge of a quad's grid of vertices. */
const CELLS = 16;

/** A canvas of MAP_SIZE square with the texels that `paint` gives each of them. */
function mapCanvas(paint: (u: number, v: number) => readonly [number, number, number]) {
	const canvas = new OffscreenCanvas(MAP_SIZE, MAP_SIZE);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('the page gave no 2d context');
	const image = context.createImageData(MAP_SIZE, MAP_SIZE);
	for (let y = 0; y < MAP_SIZE; y++) {
		for (let x = 0; x < MAP_SIZE; x++) {
			const [r, g, b] = paint(x / MAP_SIZE, y / MAP_SIZE);
			const at = (y * MAP_SIZE + x) * 4;
			image.data[at] = Math.round(Math.min(Math.max(r, 0), 1) * 255);
			image.data[at + 1] = Math.round(Math.min(Math.max(g, 0), 1) * 255);
			image.data[at + 2] = Math.round(Math.min(Math.max(b, 0), 1) * 255);
			image.data[at + 3] = 255;
		}
	}
	context.putImageData(image, 0, 0);
	return canvas;
}

/** The mesh of a quad: positions, normals and texture coordinates. */
function quadMesh(width: number, height: number) {
	const side = CELLS + 1;
	const positions = new Float32Array(side * side * 3);
	const normals = new Float32Array(side * side * 3);
	const uvs = new Float32Array(side * side * 2);
	for (let row = 0; row < side; row++) {
		for (let column = 0; column < side; column++) {
			const k = row * side + column;
			const u = column / CELLS;
			const v = row / CELLS;
			positions.set([(u - 0.5) * width, (v - 0.5) * height, 0], k * 3);
			normals.set([0, 0, 1], k * 3);
			uvs.set([u, v], k * 2);
		}
	}
	const indices = new Uint16Array(CELLS * CELLS * 6);
	let at = 0;
	for (let row = 0; row < CELLS; row++) {
		for (let column = 0; column < CELLS; column++) {
			const a = row * side + column;
			const b = a + 1;
			const c = a + side;
			const d = c + 1;
			indices.set([a, b, d, a, d, c], at);
			at += 6;
		}
	}
	return { positions, normals, uvs, indices };
}

/** The bake: a warm wash with a grid of brighter patches, so the radiance varies per pixel. */
function radiance(u: number, v: number): readonly [number, number, number] {
	const patch = Math.abs(Math.sin(u * Math.PI * 6) * Math.sin(v * Math.PI * 4));
	return [0.35 + 0.5 * patch, 0.3 + 0.45 * patch, 0.22 + 0.35 * patch];
}

/** The bake's light direction, turned about the view's axes so neighbouring texels differ. */
function direction(u: number, v: number): readonly [number, number, number] {
	const turn = (u - 0.5) * Math.PI;
	const tilt = (v - 0.5) * Math.PI * 0.5;
	const x = Math.sin(turn) * Math.cos(tilt);
	const y = Math.sin(tilt);
	const z = Math.cos(turn) * Math.cos(tilt);
	return [0.5 + 0.5 * x, 0.5 + 0.5 * y, 0.5 + 0.5 * z];
}

/** The normal map: ridges along one axis, so the normal turns across each quad. */
function bumpy(u: number, _v: number): readonly [number, number, number] {
	const slope = Math.cos(u * Math.PI * 8) * 1.2;
	const length = Math.sqrt(slope * slope + 1);
	return [0.5 + 0.5 * (slope / length), 0.5, 0.5 + 0.5 * (1 / length)];
}

export default defineSketch(({ scene, materials, geometry, textures, quality, page }) => {
	quality.set({ governor: false });
	scene.setBackground('#4a6a8a');
	scene.setActiveCamera(
		scene.createOrthographicCamera({
			height: VIEW_HEIGHT,
			near: 0.1,
			far: 20,
			position: [0, 0, 5],
			target: [0, 0, 0],
		}),
	);
	// The bake lights the quads, so the direction's weight shows in the picture, not only the sun.
	scene.createDirectionalLight({
		direction: [-0.4, -0.6, -0.7],
		color: '#fff4e0',
		intensity: 0.25,
	});
	scene.createAmbientLight({ color: '#9fb4d8', intensity: 0.15 });
	const data = { colorSpace: 'linear', mipmaps: true } as const;
	const lightMap: Texture = textures.fromCanvas(mapCanvas(radiance), data);
	const lightMapDirection: Texture = textures.fromCanvas(mapCanvas(direction), data);
	const normalMap: Texture = textures.fromCanvas(mapCanvas(bumpy), data);

	const look = { color: '#c8bfa8', roughness: 0.75, lightMap, normalMap } as const;
	const plain = materials.standard(look);
	const directional = materials.standard({ ...look, lightMapDirection });

	const quads: Mesh[] = [];
	const tile = geometry.fromArrays(quadMesh(GRID_WIDTH / COLUMNS, VIEW_HEIGHT / ROWS));
	for (let row = 0; row < ROWS; row++) {
		for (let column = 0; column < COLUMNS; column++) {
			quads.push(
				scene.createMesh({
					mesh: tile,
					material: plain,
					position: [
						(column + 0.5) * (GRID_WIDTH / COLUMNS) - GRID_WIDTH / 2,
						(row + 0.5) * (VIEW_HEIGHT / ROWS) - VIEW_HEIGHT / 2,
						0,
					],
				}),
			);
		}
	}

	page.onMessage((message) => {
		if (message !== 'direction' && message !== 'direction-off') return;
		const material: Material = message === 'direction' ? directional : plain;
		for (const quad of quads) quad.setMaterial(material);
		void scene.warmUp().then(() => page.post('settled', { quads: quads.length }));
	});
});
