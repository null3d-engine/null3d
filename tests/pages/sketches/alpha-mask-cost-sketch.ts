// The curtain of lit quads for the page that measures what an alpha-masked lit fragment costs under
// MSAA (tests/pages/alpha-mask-cost.ts): a grid of quads fills the view once, with no overlap, so
// every screen pixel shades one fragment whichever material draws it. Diagonal bands of vertex alpha
// cut half of each quad's fragments. The page's messages swap every quad between the two builds of
// the standard material, which read the same vertices and differ only in the masked build's alpha
// test and the discard that follows it. The depth prepass stays off, so no quad is skipped by a
// depth already in the target, and the governor stays off, so the render scale holds.
import { defineSketch, type Material, type Mesh } from '@null3d/engine';

/** The quads across and down the view, and the view's height in world units. */
const COLUMNS = 6;
const ROWS = 4;
const VIEW_HEIGHT = 2;
/** The view's width that the grid covers, in world units: more than a 16:9 window shows. */
const GRID_WIDTH = 4.8;
/** The cells along each edge of a quad's grid of vertices, and the cells of each alpha band. */
const CELLS = 16;
const BAND = 2;

/** The mesh of a quad: positions, normals and colors whose alpha alternates in diagonal bands. */
function bandMesh(width: number, height: number) {
	const side = CELLS + 1;
	const positions = new Float32Array(side * side * 3);
	const normals = new Float32Array(side * side * 3);
	const colors = new Float32Array(side * side * 4);
	for (let row = 0; row < side; row++) {
		for (let column = 0; column < side; column++) {
			const k = row * side + column;
			positions.set([(column / CELLS - 0.5) * width, (row / CELLS - 0.5) * height, 0], k * 3);
			normals.set([0, 0, 1], k * 3);
			const kept = (column + row) % (BAND * 2) < BAND;
			colors.set([1, 1, 1, kept ? 1 : 0], k * 4);
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
	return { positions, normals, colors, indices };
}

export default defineSketch(({ scene, materials, geometry, quality, page }) => {
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
	scene.createDirectionalLight({
		direction: [-0.4, -0.6, -0.7],
		color: '#fff4e0',
		intensity: 3,
	});
	scene.createAmbientLight({ color: '#9fb4d8', intensity: 0.6 });

	const look = { color: '#c8bfa8', roughness: 0.75, vertexColors: true } as const;
	const masked = materials.standard({
		...look,
		alphaMode: 'mask',
		alphaCutoff: 0.5,
		alphaToCoverage: false,
	});
	const opaque = materials.standard(look);

	const quads: Mesh[] = [];
	const tile = geometry.fromArrays(bandMesh(GRID_WIDTH / COLUMNS, VIEW_HEIGHT / ROWS));
	for (let row = 0; row < ROWS; row++) {
		for (let column = 0; column < COLUMNS; column++) {
			quads.push(
				scene.createMesh({
					mesh: tile,
					material: opaque,
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
		if (message !== 'mask' && message !== 'mask-off') return;
		const material: Material = message === 'mask' ? masked : opaque;
		for (const quad of quads) quad.setMaterial(material);
		void scene.warmUp().then(() => page.post('settled', { quads: quads.length }));
	});
});
