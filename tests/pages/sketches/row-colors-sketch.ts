// Instance batches whose rows bring colors of their own, for their image test. Each line of eight
// rows takes another route through the engine: a static batch of lit boxes, a dynamic batch of
// unlit spheres, a static batch with a base color map, a masked batch whose rows below the cutoff
// draw nothing, and a batch that blends, which the transparent pass sorts. A batch without colors
// stands beside them in the material's own color, and the rows of the last line cast shadows.
import { defineSketch } from '@null3d/engine';

/** Rows of each line, and the distance between their centers. */
const ROWS = 8;
const SPACING = 1.1;

/** A rainbow color for row `row`, with an alpha that falls along the line. */
function rowColor(row: number): [number, number, number, number] {
	const hue = (row / ROWS) * Math.PI * 2;
	const channel = (shift: number) => 0.55 + 0.45 * Math.cos(hue - shift);
	return [channel(0), channel(2.1), channel(4.2), 1 - row / ROWS];
}

export default defineSketch(({ scene, materials, geometry, textures }) => {
	scene.setBackground('#1c2026');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.1,
			far: 60,
			position: [0, 11, 8],
			target: [0, 0, 0.3],
		}),
	);
	scene.createDirectionalLight({
		direction: [-0.4, -1, -0.5],
		color: '#ffffff',
		intensity: 2.5,
		castShadows: true,
		shadow: { cascades: 1, mapSize: 1024, distance: 30 },
	});
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.5 });
	scene.createMesh({
		mesh: geometry.box({ width: 14, height: 0.1, depth: 8 }),
		material: materials.standard({ color: '#9a9a94' }),
		position: [0, -0.55, 0],
		receiveShadows: true,
	});

	const box = geometry.box({ width: 0.8, height: 0.8, depth: 0.8 });
	const sphere = geometry.sphere({ radius: 0.45 });
	const stripes = textures.fromData({
		width: 2,
		height: 2,
		data: new Uint8Array([
			255, 255, 255, 255, 90, 90, 90, 255, 90, 90, 90, 255, 255, 255, 255, 255,
		]),
		colorSpace: 'srgb',
		filter: 'nearest',
	});
	const white = { color: '#ffffff', roughness: 0.6 } as const;
	const lines = [
		{ mesh: box, material: materials.standard(white), dynamic: false },
		{ mesh: sphere, material: materials.unlit({ color: '#ffffff' }), dynamic: true },
		{ mesh: box, material: materials.standard({ ...white, map: stripes }), dynamic: false },
		{
			mesh: box,
			material: materials.standard({ ...white, alphaMode: 'mask', alphaCutoff: 0.5 }),
			dynamic: true,
		},
		{
			mesh: box,
			material: materials.standard({ ...white, alphaMode: 'blend' }),
			dynamic: false,
		},
	];
	lines.forEach(({ mesh, material, dynamic }, line) => {
		const z = (line - 2) * 1.4;
		const batch = scene.createInstances(mesh, ROWS, {
			material,
			dynamic,
			colors: true,
			castShadows: line === lines.length - 1,
			receiveShadows: true,
		});
		const { positions, colors } = batch;
		if (!colors) throw new Error('a batch with colors has colors');
		for (let row = 0; row < ROWS; row++) {
			positions.set([(row - (ROWS - 1) / 2) * SPACING - 1, 0, z], row * 3);
			colors.set(rowColor(row), row * 4);
		}
		batch.markDirty();
		// The same mesh and material without colors, past the line's end.
		const plain = scene.createInstances(mesh, 1, { material, receiveShadows: true });
		plain.positions.set([((ROWS + 1) / 2) * SPACING, 0, z]);
		plain.markDirty();
	});
});
