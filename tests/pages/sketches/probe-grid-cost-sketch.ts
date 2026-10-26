// The scene that times the probe grid's light: LAYERS planes of the standard material, each over the
// whole view, which draw over one another with no depth test, so every pixel shades each plane and
// the GPU's time grows with the shading's cost. The built-in room lights them throughout. The page's
// 'grid' message sets a small grid over the planes, whose probes all carry their whole weight and see
// the whole sky, and 'grid-off' takes it away again, so the difference between the sides is the cost
// of reading the grid, not of the light that it was baked with. The render scale stays at the
// `?scale=` value, 1 by default, with the governor off.
import { defineSketch, LightProbeGridData } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const SCALE = Number(params.get('scale') ?? '1');
const LAYERS = Number(params.get('layers') ?? '8');
/** The probes along each axis, and the box they cover, in the world units of the planes. */
const COUNTS: [number, number, number] = [4, 2, 4];
const EXTENT = 4;

export default defineSketch(
	async ({ scene, materials, geometry, quality, assets, page, textures }) => {
		quality.set({ minRenderScale: SCALE, maxRenderScale: SCALE, governor: false });
		scene.setBackground('#000000');
		scene.setActiveCamera(
			scene.createOrthographicCamera({ height: 2, near: 0.1, far: 10, position: [0, 0, 5] }),
		);
		scene.createAmbientLight({ intensity: 0.2 });
		scene.setEnvironment(await assets.builtinEnvironment('room'));
		// Wide enough for any window's shape, at a slant so each pixel reads another part of the grid.
		const plane = geometry.plane({ width: 8, height: 3 });
		for (let k = 0; k < LAYERS; k++) {
			const material = materials.standard({
				color: '#d8a860',
				metalness: k % 2,
				roughness: (k + 0.5) / LAYERS,
				depthTest: false,
			});
			const layer = scene.createMesh({ mesh: plane, material, position: [0, 0, -k * 0.01] });
			layer.setRotationEuler(0.3, 0.2 * (k - LAYERS / 2), 0);
		}
		const probes = COUNTS[0] * COUNTS[1] * COUNTS[2];
		const coefficients = new Float32Array(probes * 12);
		for (let at = 0; at < coefficients.length; at += 12) {
			coefficients[at] = 0.3;
			coefficients[at + 1] = 0.35;
			coefficients[at + 2] = 0.4;
		}
		const spacing = COUNTS.map((count) => (2 * EXTENT) / (count - 1)) as [number, number, number];
		const grid = new LightProbeGridData(
			new Float32Array([-EXTENT, -EXTENT, -EXTENT]),
			new Float32Array(spacing),
			COUNTS,
			coefficients,
		);
		const options = {
			texture: grid.toTexture(textures),
			origin: grid.origin,
			spacing: grid.spacing,
			counts: grid.counts,
		};
		page.onMessage((message) => {
			if (message === 'grid') scene.setLightProbeGrid(options);
			if (message === 'grid-off') scene.setLightProbeGrid(null);
		});
	},
);
