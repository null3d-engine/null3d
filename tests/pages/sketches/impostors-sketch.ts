// Impostors of the impostors add-on, in hold mode: a grid of cards that face the camera, each
// showing the atlas cell nearest the direction from the card toward the eye, and a row of merged
// far geometry. The atlas is made in code: each cell holds a disc tinted by the direction its view
// was drawn from, so a card's color shows which view it picked. The cards' positions are relative
// to an origin far from the world's, which `update` must subtract. The merged row holds a plain, a
// turned and a mirrored copy of one panel; the mirrored one draws only when the merge reverses its
// winding. The camera stands still, so every run draws the same frame on every GPU path.
import { defineSketch, type MeshArrays } from '@null3d/engine';
import {
	createImpostors,
	frameDirection,
	mergeFarGeometry,
	octahedralAtlas,
} from '@null3d/impostors';

/** The point that the cards and the scene sit around, far from the world's origin. */
const ORIGIN = [400, 0, -250] as const;

/** The texels on each side of an atlas cell. */
const CELL = 32;

/** A panel one unit square facing +z, standing on its bottom edge, with its tangents along +x. */
const PANEL: MeshArrays = {
	positions: new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]),
	normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
	tangents: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]),
	indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
};

/** A column-major transform that moves by x and z, turns by `turn` about y and scales x. */
function place(x: number, z: number, turn: number, scaleX: number): number[] {
	const c = Math.cos(turn);
	const s = Math.sin(turn);
	return [c * scaleX, 0, -s * scaleX, 0, 0, 1, 0, 0, s, 0, c, 0, x, 0, z, 1];
}

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, textures } = ctx;
	scene.setBackground('#20262f');
	scene.createDirectionalLight({ direction: [-0.3, -1, -0.6], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.5 });
	const eye: [number, number, number] = [ORIGIN[0] + 2, ORIGIN[1] + 7, ORIGIN[2] + 13];
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: eye,
		target: [ORIGIN[0], ORIGIN[1] + 1, ORIGIN[2] - 2],
	});
	scene.setActiveCamera(camera);
	scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 24 }),
		material: materials.standard({ color: '#3d4450', roughness: 0.95 }),
		position: [ORIGIN[0], ORIGIN[1], ORIGIN[2] - 2],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	// The atlas: a disc per cell, tinted by its view's direction, with a clear ground around it.
	const atlas = octahedralAtlas(16);
	const width = atlas.columns * CELL;
	const height = atlas.rows * CELL;
	const data = new Uint8Array(width * height * 4);
	const direction: [number, number, number] = [0, 0, 0];
	for (let frame = 0; frame < atlas.columns * atlas.rows; frame++) {
		frameDirection(frame, atlas, direction);
		const left = (frame % atlas.columns) * CELL;
		// Frame 0 is the top left cell, and the first row of texels is the image's bottom.
		const bottom = (atlas.rows - 1 - Math.floor(frame / atlas.columns)) * CELL;
		for (let y = 0; y < CELL; y++)
			for (let x = 0; x < CELL; x++) {
				const r = Math.hypot((x + 0.5) / CELL - 0.5, (y + 0.5) / CELL - 0.5) * 2;
				const at = ((bottom + y) * width + left + x) * 4;
				const shade = r < 0.6 ? 1 : 0.55;
				data[at] = Math.round((direction[0] * 0.5 + 0.5) * 255 * shade);
				data[at + 1] = Math.round((direction[1] * 0.5 + 0.5) * 255 * shade);
				data[at + 2] = Math.round((direction[2] * 0.5 + 0.5) * 255 * shade);
				data[at + 3] = r < 0.9 ? 255 : 0;
			}
	}
	const texture = textures.fromData({ width, height, data, colorSpace: 'srgb', wrap: 'clamp' });

	// A grid of cards on both sides of the eye and below it, so they pick many views.
	const positions: number[] = [];
	for (let row = 0; row < 5; row++)
		for (let column = 0; column < 7; column++) positions.push((column - 3) * 3, 0, -row * 3);
	const cards = await createImpostors(scene, {
		texture,
		atlas,
		positions,
		size: 1.6,
		alphaMode: 'mask',
		origin: ORIGIN,
	});
	cards.update(eye);

	// The merged row in front of the cards: a plain, a turned and a mirrored copy of the panel.
	const merged = mergeFarGeometry([
		{ arrays: PANEL, transform: place(ORIGIN[0] - 2, ORIGIN[2] + 4, 0, 1) },
		{ arrays: PANEL, transform: place(ORIGIN[0], ORIGIN[2] + 4, 0.5, 1) },
		{ arrays: PANEL, transform: place(ORIGIN[0] + 2, ORIGIN[2] + 4, 0, -1) },
	]);
	scene.createMesh({
		mesh: geometry.fromArrays(merged),
		material: materials.standard({ color: '#e0b060', roughness: 0.6 }),
	});

	// The camera never moves, so the views picked from its known position above stay right. Reading
	// its world position every frame would pick the world origin on the first one, because the
	// engine reports the matrix of the frame that last ran, and no frame has run yet.
	return {};
});
