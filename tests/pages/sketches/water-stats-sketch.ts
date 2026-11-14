// A small lake drawn by @null3d/water, so the stats overlay has the add-on's own row to show. The
// message `preset` switches the quality preset, which moves the row's cadence and budget.
import { defineSketch, type QualityPreset } from '@null3d/engine';
import { createWater } from '@null3d/water';

/** The lake's shore, a circle of 48 points in meters. */
const SHORE: [number, number][] = Array.from({ length: 48 }, (_, index) => {
	const angle = (index / 48) * Math.PI * 2;
	return [Math.cos(angle) * 6, Math.sin(angle) * 6];
});

export default defineSketch((ctx) => {
	const { scene, geometry, materials, quality, page } = ctx;
	// The governor's steps would move the row's budget during the test, so the row holds the
	// preset's own values.
	void quality.set({ governor: false });
	scene.createDirectionalLight({ direction: [-1, -2, -1] });
	// A bed below the surface, and a rock above it, which the reflection pass mirrors.
	scene.createMesh({
		mesh: geometry.box({ width: 30, height: 0.2, depth: 30 }),
		material: materials.standard({ color: '#556b3f', roughness: 1 }),
		position: [0, -1.5, 0],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 1.2 }),
		material: materials.standard({ color: '#d06a3a', roughness: 0.5 }),
		position: [3, 0.2, 0],
	});
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 4, 12], target: [0, 0, 0] }));
	const water = createWater(ctx, {
		shapes: { kind: 'lake', shore: SHORE, depth: 1.5, shoreWidth: 1 },
		// Low draws the reflection every third frame, so the row changes within every device's cap.
		reflectionEvery: { low: 3 },
	});
	page.onMessage((name, data) => {
		if (name !== 'preset') return;
		void quality.setPreset(data as QualityPreset).then(
			() => page.post('preset', quality.preset),
			(error: Error) => page.post('preset', { failed: error.message }),
		);
	});
	return {
		onUpdate() {
			water.update();
		},
	};
});
