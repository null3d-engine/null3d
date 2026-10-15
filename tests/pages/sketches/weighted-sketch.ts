// Weighted blending, which null3D draws the same way on every tier:
// - three panes of red, green and blue glass that cross each other, double-sided, with an opaque
//   post through their middle that hides what lies behind it;
// - a cluster of gray puffs that overlap, unlit and lit, with no depth writes;
// - a pane of normal blending behind them, which the weighted layer draws over.
// ?sorted gives the panes and the puffs the normal blending, so the transparent pass sorts them.
// ?reverse reverses their render order, which changes the sorted image and leaves the weighted one
// as it is.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const blending = params.has('sorted') ? 'normal' : 'weighted';
const reverse = params.has('reverse');

/** The puffs of the cluster: their centers, radii and grays. */
const PUFFS = [
	[-0.35, 1.1, 0.1, 0.55, '#9a9590'],
	[0.25, 1.3, -0.15, 0.6, '#c8c2bb'],
	[0.05, 0.85, 0.3, 0.45, '#6f6a66'],
	[-0.15, 1.55, -0.25, 0.5, '#e0dbd4'],
	[0.45, 0.95, 0.25, 0.4, '#857f79'],
	[-0.5, 1.45, 0.25, 0.42, '#b1aaa3'],
] as const;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#1c2129');
	scene.createDirectionalLight({ direction: [-1, -2, -1.5], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.5 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 45, position: [0.6, 2.2, 6.5], target: [0.4, 1.1, 0] }),
	);
	scene.createMesh({
		mesh: geometry.box({ width: 12, height: 0.2, depth: 8 }),
		material: materials.standard({ color: '#7b818c', roughness: 0.8 }),
		position: [0, -0.1, 0],
	});

	// A pane of normal blending behind the others: the weighted layer draws over it.
	scene.createMesh({
		mesh: geometry.plane({ width: 5, height: 2.4 }),
		material: materials.standard({ color: '#f0c040', opacity: 0.5, alphaMode: 'blend' }),
		position: [0.5, 1.2, -2.2],
	});

	// Three panes that cross along a vertical line, and an opaque post through them.
	const pane = geometry.plane({ width: 2.4, height: 1.8 });
	const panes = [
		['#e03020', 0],
		['#20c040', Math.PI / 3],
		['#2050f0', (2 * Math.PI) / 3],
	] as const;
	let order = 0;
	const nextOrder = () => (reverse ? -order++ : order++);
	for (const [color, angle] of panes) {
		const glass = materials.standard({
			color,
			opacity: 0.45,
			roughness: 0.15,
			alphaMode: 'blend',
			blending,
			doubleSided: true,
		});
		const mesh = scene.createMesh({ mesh: pane, material: glass, position: [-1.4, 1.1, 0] });
		mesh.setRotationEuler(0, angle, 0);
		mesh.setRenderOrder(nextOrder());
	}
	scene.createMesh({
		mesh: geometry.box({ width: 0.12, height: 2.2, depth: 0.12 }),
		material: materials.standard({ color: '#303438', roughness: 0.5 }),
		position: [-1.4, 1.1, 0],
	});

	// The puffs: lit ones on the left, unlit ones on the right.
	const puff = geometry.sphere({ radius: 1, widthSegments: 24, heightSegments: 16 });
	for (const [lit, x] of [
		[true, 1.0],
		[false, 2.4],
	] as const)
		for (const [dx, y, z, radius, color] of PUFFS) {
			const options = {
				color,
				opacity: 0.4,
				alphaMode: 'blend',
				blending,
				depthWrite: false,
			} as const;
			const material = lit ? materials.standard(options) : materials.unlit(options);
			const mesh = scene.createMesh({ mesh: puff, material, position: [x + dx, y, z] });
			mesh.setScale(radius, radius, radius);
			mesh.setRenderOrder(nextOrder());
		}
});
