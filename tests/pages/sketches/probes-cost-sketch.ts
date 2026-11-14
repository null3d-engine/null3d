// A room of boxes whose light probe grid this page times, for the effect cost page: LAYERS planes
// of the standard material fill the view, layer over layer, with no depth test, so every pixel
// shades every plane and the grid's four filtered reads happen at each of them. The 'probes'
// message sets the baked grid and posts 'settled' once a frame drew with it, and 'probes-off'
// removes it, so the two sides differ by the grid's reads alone. The bake runs in the setup, so it
// is in neither side's timing. ?scale= draws at that render scale, ?layers= sets the planes, and
// ?fixed holds the scale with the governor off, for timing.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { bakeProbes, defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');
const LAYERS = Number(params.get('layers') ?? '2048');

export default defineSketch(
	async ({ scene, assets, materials, geometry, textures, quality, page }) => {
		// The grid takes the place of the screen-space bounce light, so both sides draw without it;
		// else the off side pays for a pass that the on side leaves out.
		quality.set({
			...(SCALE !== null && { minRenderScale: Number(SCALE), maxRenderScale: Number(SCALE) }),
			bounceRays: 0,
			governor: !FIXED,
		});
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
		// The slabs fill the view, each drawn over the last, so the grid's read happens at every
		// pixel of every layer and the frame's cost follows it. Five materials and one mesh are
		// shared, because the material table holds few and each object would take one.
		const slab = geometry.box({ width: 6, height: 4, depth: 0.02 });
		const slabMaterials = palette.map((colour) =>
			materials.standard({
				color: colour,
				roughness: 0.8,
				// No layer writes depth, so every one passes and shades the view over the last.
				depthWrite: false,
			}),
		);
		for (let k = 0; k < LAYERS; k++) {
			const material = slabMaterials.at(k % slabMaterials.length);
			if (!material) throw new Error('the palette made no slab material');
			const object = scene.createMesh({
				mesh: slab,
				material,
				position: [0, 2, 5 - k * 0.0005],
			});
			colours.set(object, palette[k % palette.length] as [number, number, number]);
		}
		const grid = bakeProbes(scene, {
			box: { min: [-5, 0.1, -5], max: [5, 5, 6.5] },
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
