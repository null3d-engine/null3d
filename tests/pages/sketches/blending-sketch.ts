// Blending and the transparent pass's order, which null3D draws the same way on every tier:
// - additive light: three overlapping spheres whose overlaps add up to white;
// - multiply tints: two overlapping planes over a light wall, whose overlap turns green;
// - a batch of blended quads, sorted row by row: each writes depth, so a quad drawn out of order
//   would hide the quads behind it;
// - render order: of two planes that write no depth, the nearer draws first, so the farther one
//   covers it where they overlap; and a plane behind the wall with no depth test, which shows;
// - a glow map with alpha, loaded with and without premultiplied colors, which must match.
import { defineSketch } from '@null3d/engine';

/** The batch's quads: a row of cards that step back from the camera and to the right. */
const CARDS = 12;

export default defineSketch(async ({ scene, materials, geometry, assets }) => {
	scene.setBackground('#101418');
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 1.6, 8], target: [0, 1.2, 0] }),
	);
	scene.createMesh({
		mesh: geometry.box({ width: 14, height: 0.2, depth: 8 }),
		material: materials.standard({ color: '#8a8f99' }),
		position: [0, -0.1, 0],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 5, height: 3, depth: 0.3 }),
		material: materials.unlit({ color: '#f0f0f0' }),
		position: [2.5, 1.5, -2],
	});

	// Additive light over the dark background.
	const ball = geometry.sphere({ radius: 0.7 });
	for (const [color, x, y] of [
		['#c02010', -3.6, 2.4],
		['#10a020', -3.0, 2.4],
		['#1030d0', -3.3, 1.9],
	] as const)
		scene.createMesh({
			mesh: ball,
			material: materials.unlit({ color, alphaMode: 'blend', blending: 'additive' }),
			position: [x, y, -1],
		});

	// Multiply tints over the light wall.
	const sheet = geometry.plane({ width: 1.4, height: 1.4 });
	for (const [color, x, z] of [
		['#40e0f0', 1.6, -1.7],
		['#f0e040', 2.4, -1.6],
	] as const)
		scene.createMesh({
			mesh: sheet,
			material: materials.unlit({ color, alphaMode: 'blend', blending: 'multiply' }),
			position: [x, 2.1, z],
		});

	// A batch whose rows sort back to front: each quad covers part of the one behind it.
	const cards = scene.createInstances(geometry.plane({ width: 0.8, height: 0.8 }), CARDS, {
		material: materials.standard({ color: '#e8554e', opacity: 0.55, alphaMode: 'blend' }),
	});
	for (let k = 0; k < CARDS; k++)
		cards.positions.set([-1.8 + k * 0.22, 0.6 + (k % 3) * 0.12, 2.2 - k * 0.35], k * 3);
	cards.markDirty();

	// Render order: the nearer plane draws first, and the farther one covers it.
	const noDepth = { alphaMode: 'blend', opacity: 0.8, depthWrite: false } as const;
	const near = scene.createMesh({
		mesh: sheet,
		material: materials.unlit({ color: '#4a8cff', ...noDepth }),
		position: [1.4, 0.8, 0.6],
	});
	near.setRenderOrder(-1);
	scene.createMesh({
		mesh: sheet,
		material: materials.unlit({ color: '#f2c14e', ...noDepth }),
		position: [2.1, 1.1, -0.4],
	});
	// Behind the wall, drawn anyway.
	scene.createMesh({
		mesh: geometry.plane({ width: 0.7, height: 0.7 }),
		material: materials.unlit({ color: '#5bc27a', alphaMode: 'blend', depthTest: false }),
		position: [3.8, 2.2, -3],
	});

	// The same glow, with straight and with premultiplied colors.
	const glow = geometry.plane({ width: 1.2, height: 1.2 });
	for (const [premultipliedAlpha, x] of [
		[false, -1.8],
		[true, -0.6],
	] as const) {
		const map = await assets.loadTexture('assets/textures/glow.png', { premultipliedAlpha });
		scene.createMesh({
			mesh: glow,
			material: materials.unlit({ map, alphaMode: 'blend' }),
			position: [x, 2.4, -1],
		});
	}
	return {};
});
