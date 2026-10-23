// Reads the frame figures in every frame, as a sketch that logs them would. The page shows the stats
// overlay. The message `figures` posts the latest figures as JSON gives them, and `show` shows or
// hides the overlay from the sketch. The message `instances` adds a batch of that many instance
// rows and turns on the shadows of the first directional light, the one that casts them, and of
// the box, then posts the shadow map's size and cascades. The message `feature` adds one add-on
// feature with its own settings, a budget and a memory figure, and posts what the engine resolved
// for it; `preset` switches the preset and posts the same for the new one.
import {
	declareAddonNamespace,
	defineFeature,
	defineSketch,
	type FeatureHandle,
	FeatureHost,
	type QualityPreset,
} from '@null3d/engine';

/** The test add-on's names, claimed once as the sketch's module loads. */
const NAMESPACE = declareAddonNamespace({ name: 'stats_test' });

export default defineSketch(({ scene, geometry, materials, debug, page, quality, engine }) => {
	let feature: FeatureHandle | undefined;
	const sun = scene.createDirectionalLight({ direction: [-1, -2, -1] });
	const box = scene.createMesh({
		mesh: geometry.box(),
		material: materials.standard({ color: '#4e8ae8' }),
	});
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [2, 2, 3], target: [0, 0, 0] }));
	/** The feature's resolved values and budget, as the sketch reads them. */
	const reading = () => ({
		samples: feature?.settings.samples,
		budgetMs: feature?.budgetMs,
		budgetScale: feature?.budgetScale,
		bytes: feature?.stats.bytes,
		gpuMs: feature?.stats.gpuMs,
	});
	page.onMessage((name, data) => {
		if (name === 'show') debug.stats(data as boolean);
		if (name === 'figures') page.post('figures', JSON.parse(JSON.stringify(debug.frameStats())));
		if (name === 'feature') {
			// The governor's steps would move the feature's values mid-test, so the page reads the
			// preset's values alone.
			void quality.set({ governor: false });
			const host = new FeatureHost({
				quality,
				tier: engine.capabilities.tier,
				page,
				namespace: NAMESPACE,
			});
			feature = host.add(
				defineFeature({
					name: 'test-glow',
					settings: {
						samples: { presets: [0, 22, 43, 71], values: [0, 16, 22, 43, 71] },
					},
					budget: { presets: [2, 4, 8, 12], min: 0 },
					memory: () => 1024 * 1024,
				}),
			);
			page.post('feature', reading());
		}
		if (name === 'preset') {
			void quality.setPreset(data as QualityPreset).then(() => page.post('preset', reading()));
		}
		if (name === 'instances') {
			sun.setCastShadows(true);
			box.setCastShadows(true);
			scene.createInstances(
				geometry.box({ width: 0.05, height: 0.05, depth: 0.05 }),
				data as number,
				{
					material: materials.standard({ color: '#e8a54e' }),
				},
			);
			const { shadowMapSize, shadowCascades } = quality.settings;
			page.post('instances', { shadowMapSize, shadowCascades });
		}
	});
	return {
		onUpdate() {
			debug.frameStats();
		},
	};
});
