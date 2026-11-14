// Custom materials keep the standard material's cut-out features: a batch of leaf cards whose own
// WGSL cuts each leaf from the card, sways it with a vertex offset, casts leaf-shaped shadows that
// sway with it, fades between levels and at the edges of a distance band, and takes alpha to
// coverage under MSAA. The mesh's vertex colors carry the wind data: how far each vertex bends in
// red and a flutter phase in green, which the vertex offset reads as VertexInput.colors. Each
// row's values give its leaf a phase in the wind and a tint.
//
// ?motion draws the motion view, where the holes that the alpha cuts show the still scene behind:
// the motion build tests the same alpha as the surface. ?solid draws the cards opaque, which the
// motion spec compares with the masked cards to find the holes.
import { defineSketch, type Geometry } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const MOTION = params.has('motion');
/** True to draw the cards opaque, which the motion test compares with the masked ones. */
const SOLID = params.has('solid');

const LEAF = /* wgsl */ `
/// The shape of a leaf from its card: an ellipse that narrows to a tip at the top.
fn leaf_shape(uv: vec2f) -> f32 {
    let across = (uv.x - 0.5) * 2.0;
    let width = sin(uv.y * 3.1415927) * 0.9;
    return step(abs(across), width);
}

fn vertexOffset(input: VertexInput) -> vec3f {
    // The mesh's vertex color holds how far a vertex bends in red and its flutter phase in green,
    // and the row's first value shifts the whole card. The tip of the leaf bends most.
    let phase = frame.time * 2.0 + input.colors.g * 6.2831853 + object.values.x;
    let bend = sin(phase) * input.colors.r * 0.4;
    let height = input.uv.y * input.uv.y;
    return vec3f(bend * height, 0.0, bend * height * 0.35);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let tint = mix(vec3f(0.3, 0.55, 0.18), vec3f(0.85, 0.72, 0.24), object.values.y);
    s.baseColor *= tint * mix(0.7, 1.0, input.uv.y);
    s.alpha = leaf_shape(input.uv);
    return s;
}
`;

const [CARD_WIDTH, CARD_HEIGHT] = [1.5, 2.1];

export default defineSketch(({ scene, materials, geometry, debug }) => {
	if (MOTION) debug.view('motion');
	scene.setBackground('#26333d');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 38,
			near: 0.1,
			far: 40,
			position: [0, 2.4, 9],
			target: [0, 1.4, 0],
		}),
	);
	scene.createDirectionalLight({
		direction: [-0.55, -1, -0.45],
		color: '#fff3dc',
		intensity: 3.2,
		castShadows: true,
		shadow: { cascades: 1, mapSize: 2048, distance: 20 },
	});
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.35 });
	scene.createMesh({
		mesh: geometry.box({ width: 14, height: 0.1, depth: 14 }),
		material: materials.standard({ color: '#7d8468' }),
		position: [0, -0.05, 0],
		receiveShadows: true,
	});

	// Two levels of one card, from the same shape: the finer card holds more rows, so a level's
	// switch shows.
	const fine = card(geometry, 4, 7);
	const coarse = card(geometry, 2, 4);

	const material = materials.shader({
		wgsl: LEAF,
		color: '#ffffff',
		roughness: 0.75,
		doubleSided: true,
		alphaMode: SOLID ? 'opaque' : 'mask',
		alphaCutoff: 0.5,
	});
	const copies = 6;
	const leaves = scene.createInstances(fine, copies, {
		material,
		values: true,
		ranges: true,
		castShadows: true,
		receiveShadows: true,
	});
	if (!leaves.values || !leaves.ranges) throw new Error('a batch with values and ranges has both');
	const distances: number[] = [];
	for (let row = 0; row < copies; row++) {
		// The cards stand in a row across the view, at depths that straddle the level's switch and
		// the far edge of a distance band.
		const x = (row - (copies - 1) / 2) * (CARD_WIDTH * 1.35);
		const z = 1.6 - row * 0.75;
		leaves.positions.set([x, 0, z], row * 3);
		leaves.rotations.set(
			[0, Math.sin((row - 2.5) * 0.18), 0, Math.cos((row - 2.5) * 0.18)],
			row * 4,
		);
		leaves.values.set([row * 1.3, row / (copies - 1), 0, 0], row * 4);
		const distance = Math.hypot(x, 9 - z);
		distances.push(distance);
		// The first card sits inside the band that ends its range, so its far edge dithers. The
		// others draw inside their ranges.
		leaves.ranges.set(row === 0 ? [0, distance + 0.35] : [0, 30], row * 2);
	}
	leaves.markDirty();
	// The level's switch lies inside the row of cards, so the copies beside it fade between the two
	// levels, and the copies past it draw the coarser one.
	fine.setLevels([{ mesh: coarse, distance: (distances[2] ?? 9) - 0.3 }]);
});

/**
 * A leaf card as a grid, with the wind data in the vertex colors: how far a vertex bends in red,
 * and a flutter phase across the leaf in green. The card stands on its bottom edge.
 */
function card(geometry: Geometry, columns: number, rows: number) {
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	for (let row = 0; row <= rows; row++) {
		for (let column = 0; column <= columns; column++) {
			const u = column / columns;
			const v = row / rows;
			positions.push((u - 0.5) * CARD_WIDTH, v * CARD_HEIGHT, 0);
			normals.push(0, 0, 1);
			uvs.push(u, v);
			// Red is how far the vertex bends, which rises toward the tip. Green is the flutter
			// phase across the leaf, and blue and alpha carry nothing here.
			colors.push(v, u, 0, 1);
		}
	}
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			const at = row * (columns + 1) + column;
			const next = at + columns + 1;
			indices.push(at, at + 1, next, at + 1, next + 1, next);
		}
	}
	return geometry.fromArrays({ positions, normals, uvs, colors, indices });
}
