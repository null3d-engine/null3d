// A row of boxes drawn with the unlit material, whose pipeline the first frame builds. When the
// page sends 'set-preset', the sketch switches to that preset and answers with its settings once
// the new preset's frame is on screen. When the sketch hears of a new preset, it draws the boxes
// with the standard material, whose pipeline the scene lacks, as a preset's start-time settings
// change pipelines. With 'swap', it switches the material without a preset change or a warm-up, so
// frames draw without the boxes until the new pipeline is built.
import { defineSketch, type QualityPreset } from '@null3d/engine';

/** Boxes in the row. */
const BOXES = 8;

export default defineSketch(({ scene, materials, geometry, quality, page }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 100,
		position: [0, 2, 12],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });
	const box = geometry.box({ width: 0.9, height: 3, depth: 0.9 });
	const unlit = materials.unlit({ color: '#4a8cff' });
	const lit = materials.standard({ color: '#e8554e' });
	const boxes = Array.from({ length: BOXES }, (_, k) =>
		scene.createMesh({ mesh: box, material: unlit, position: [(k - (BOXES - 1) / 2) * 1.2, 0, 0] }),
	);
	const drawLit = () => {
		for (const mesh of boxes) mesh.setMaterial(lit);
	};
	let preset = quality.preset;
	quality.onChange(() => {
		if (quality.preset === preset) return;
		preset = quality.preset;
		drawLit();
	});
	page.onMessage(async (name, data) => {
		if (name === 'swap') drawLit();
		if (name !== 'set-preset') return;
		await quality.setPreset(data as QualityPreset);
		page.post('preset-set', { preset: quality.preset, settings: { ...quality.settings } });
	});
	return {};
});
