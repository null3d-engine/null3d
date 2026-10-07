// Lit lines: helixes of a standard material that the sun, a red point light and the ambient light
// shade, one rough and one smooth and metallic, a line that gives off its own light, and a dashed
// line whose width is in world units, all in linear fog. Beside them, an unlit line keeps its color
// but takes the fog. three.js has no lit lines, so this test has no twin.
import { defineSketch } from '@null3d/engine';

/** The points of a helix about the vertical line through `x`, `z`. */
function helix(x: number, z: number): number[] {
	const points: number[] = [];
	for (let k = 0; k < 60; k++) {
		const angle = (k / 59) * 3 * 2 * Math.PI;
		points.push(x + 0.6 * Math.cos(angle), 0.2 + (2.2 * k) / 59, z + 0.6 * Math.sin(angle));
	}
	return points;
}

export default defineSketch(async ({ scene, materials, geometry }) => {
	scene.setBackground('#202830');
	scene.setFog({ curve: 'linear', color: '#202830', near: 6, far: 16 });
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.3 });
	scene.createPointLight({ position: [0, 1.4, 1], color: '#ff4030', intensity: 8, range: 4 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ position: [0, 1.6, 6], target: [0, 1, 0] }),
	);
	scene.createMesh({
		mesh: geometry.box({ width: 12, height: 0.2, depth: 20 }),
		material: materials.standard({ color: '#8a8f99' }),
		position: [0, -0.1, -4],
	});
	const lit = { lit: true, width: 6, color: '#d8d8d8' } as const;
	await scene.createLines({ ...lit, positions: helix(-1.6, 0) });
	await scene.createLines({
		...lit,
		positions: helix(1.6, 0),
		metalness: 0.8,
		roughness: 0.3,
	});
	await scene.createLines({
		lit: true,
		positions: [-2.6, 2.8, -1, 2.6, 2.8, -1],
		color: '#000000',
		emissive: '#40c0ff',
		emissiveIntensity: 2,
		width: 8,
	});
	await scene.createLines({
		lit: true,
		positions: [-3, 0.05, 2.5, -1, 0.05, -2, 1, 0.05, -9, 3, 0.05, -14],
		color: '#f0d040',
		width: 0.15,
		worldUnits: true,
		dashed: true,
		dashSize: 0.6,
		gapSize: 0.3,
	});
	await scene.createLines({
		positions: [-3, 0.4, 1.5, 0, 0.6, -6, 3, 0.4, -12],
		color: '#e05cff',
		width: 4,
	});
});
