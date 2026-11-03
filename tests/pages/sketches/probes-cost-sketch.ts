// A room full of boxes, for the effect cost page: the 'probes' message sets the baked light probe
// grid and posts 'settled' once a frame drew with it, and 'probes-off' removes it, so the two sides
// differ by the grid's four filtered reads at each lit pixel alone. The bake runs in the setup, so
// it is in neither side's timing. ?scale= draws at that render scale, and ?fixed holds it with the
// governor off, for timing.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { bakeProbes, defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');

export default defineSketch(
	async ({ scene, assets, materials, geometry, textures, quality, page }) => {
		if (SCALE !== null) {
			const scale = Number(SCALE);
			quality.set({
				minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
				maxRenderScale: scale,
				governor: !FIXED,
			});
		}
		const environment = await assets.builtinEnvironment('room');
		scene.setEnvironment(environment);
		scene.setBackground('#20242c');
		scene.setActiveCamera(
			scene.createPerspectiveCamera({ fov: 55, position: [0, 2, 6.4], target: [0, 2, -1] }),
		);
		// Each surface's colour, which the bake's bounce takes from the object that a ray hits.
		const colours = new Map<unknown, readonly [number, number, number]>();
		const surface = (
			colour: readonly [number, number, number],
			size: [number, number, number],
			position: [number, number, number],
		) => {
			const object = scene.createMesh({
				mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
				material: materials.standard({ color: colour, roughness: 0.85 }),
				position,
			});
			colours.set(object, colour);
		};
		surface([0.8, 0.8, 0.8], [10, 0.2, 10], [0, -0.1, 0]);
		surface([0.8, 0.8, 0.8], [10, 6, 0.2], [0, 3, -5]);
		surface([0.8, 0.1, 0.08], [0.2, 6, 10], [-5, 3, 0]);
		surface([0.1, 0.7, 0.12], [0.2, 6, 10], [5, 3, 0]);
		// Boxes fill the view with lit pixels, so the grid's read is a large part of the frame.
		const palette: [number, number, number][] = [
			[0.8, 0.3, 0.2],
			[0.2, 0.6, 0.8],
			[0.9, 0.8, 0.3],
			[0.5, 0.4, 0.8],
			[0.8, 0.8, 0.8],
		];
		let n = 0;
		for (let x = -4; x <= 4; x++)
			for (let y = 0.5; y <= 4; y += 0.9)
				for (let z = -4; z <= 2; z += 1.1) {
					const colour = palette[n++ % palette.length] as [number, number, number];
					surface(colour, [0.7, 0.7, 0.7], [x * 0.95, y, z]);
				}
		const grid = bakeProbes(scene, {
			box: { min: [-5, 0.1, -5], max: [5, 5, 5] },
			spacing: 1,
			samples: 32,
			environment,
			albedo: (object) => (object ? colours.get(object) : undefined),
		}).finish();
		const options = {
			texture: grid.toTexture(textures),
			origin: grid.origin,
			spacing: grid.spacing,
			counts: grid.counts,
		};
		let settle: (() => void) | undefined;
		page.onMessage((type) => {
			if (type === 'probes') {
				scene.setLightProbeGrid(options);
				settle = () => page.post('settled');
			} else if (type === 'probes-off') {
				scene.setLightProbeGrid(null);
				settle = () => page.post('settled');
			}
		});
		return {
			onUpdate() {
				if (settle) {
					const report = settle;
					settle = undefined;
					report();
				}
			},
		};
	},
);
