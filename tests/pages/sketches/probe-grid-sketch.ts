// A light probe grid, baked in the browser: a room open at the front and the top, with a red wall
// at the left, a green wall at the right and a white back wall and floor, lit by the built-in room
// environment alone. Three grey spheres stand in the room. The bake runs in the setup, before the
// first frame: hold mode, which the image tests use, draws its one frame without running any of the
// sketch's code, and a grid set after the first frame draws with the plain lit builds until the
// grid's own builds are ready. The held frame draws with the grid, so the spheres take red light at
// the left and green light at the right, and the room's corners darken. ?off draws the same room without the grid. ?mirror lays a mirror on the
// floor in front of the spheres, which a reflection pass fills: the reflected spheres must take the
// grid's light of their own place, as the spheres above the mirror do, not that of a place below
// the floor. ?wall puts a partition in the room, thick enough to hold a row of probes, whose light
// the validity mask stops; ?wall-leak draws the same bake with every probe valid, which shows the
// leak beside it; and ?wall-night turns the environment after the bake, which must light the grid
// again with no new bake.
import { bakeProbes, defineSketch, LightProbeGridData, type QueryTarget } from '@null3d/engine';
import { applySketchSwitches } from '../lib/sketch-switches';

const params = new URL(import.meta.url).searchParams;

const mirrorWgsl = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, vec2f(0.0));
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 1.0);
    return s;
}
`;

type Colour = readonly [number, number, number];

export default defineSketch(async (context) => {
	const { scene, assets, materials, geometry, textures, render, quality } = context;
	applySketchSwitches(import.meta.url, quality);
	const environment = await assets.builtinEnvironment('room');
	scene.setEnvironment(environment);
	scene.setBackground('#20242c');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 2.2, 6.5], target: [0, 1, 0] }),
	);

	// Each surface's colour, which the bake's bounce takes from the object that a ray hits.
	const colours = new Map<QueryTarget, Colour>();
	const surface = (
		colour: Colour,
		size: [number, number, number],
		position: [number, number, number],
	) => {
		const object = scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material: materials.standard({ color: colour, roughness: 0.9 }),
			position,
		});
		colours.set(object, colour);
	};
	const white: Colour = [0.8, 0.8, 0.8];
	surface(white, [6, 0.2, 6], [0, -0.1, 0]);
	surface(white, [6, 3, 0.2], [0, 1.5, -3.1]);
	surface([0.8, 0.08, 0.06], [0.2, 3, 6], [-3.1, 1.5, 0]);
	surface([0.08, 0.7, 0.1], [0.2, 3, 6], [3.1, 1.5, 0]);
	const grey: Colour = [0.6, 0.6, 0.6];
	for (const x of [-1.8, 0, 1.8]) {
		const sphere = scene.createMesh({
			mesh: geometry.sphere({ radius: 0.6 }),
			material: materials.standard({ color: grey, roughness: 0.7 }),
			position: [x, 0.6, -1],
		});
		colours.set(sphere, grey);
	}

	if (params.has('mirror')) {
		const pass = render.addPass({
			kind: 'reflection',
			writes: 'mirror',
			plane: { point: [0, 0.01, 0] },
		});
		const floor = scene.createMesh({
			mesh: geometry.plane({ width: 5, height: 1.6 }),
			material: materials.shader({
				wgsl: mirrorWgsl,
				color: '#ffffff',
				roughness: 0,
				metalness: 1,
				textures: { mirror: textures.fromPass(pass) },
			}),
			position: [0, 0.01, 0.6],
		});
		floor.setRotationEuler(-Math.PI / 2, 0, 0);
	}

	if (params.has('off')) return {};
	// A wall thick enough to hold the row of probes along z, whose light the validity mask stops:
	// ?wall draws it, and ?wall-night turns the environment after the bake to show that the sky
	// needs no new one.
	const wall = params.has('wall') || params.has('wall-leak') || params.has('wall-night');
	if (wall) {
		// Behind the spheres, so it holds the row of probes at z = -1.9 without meeting them.
		surface([0.75, 0.72, 0.68], [4.4, 3, 1.2], [-0.8, 1.5, -2.3]);
		scene.setActiveCamera(
			scene.createPerspectiveCamera({
				fov: 55,
				position: [1.9, 2.3, 2.6],
				target: [-1.4, 0.9, -2.0],
			}),
		);
	}
	const baked = bakeProbes(scene, {
		box: { min: [-2.9, 0.1, -2.9], max: [2.9, 2.9, 2.9] },
		spacing: 1,
		environment,
		albedo: (object) => (object ? colours.get(object) : undefined),
	}).finish();
	// ?wall-leak draws the same bake with every probe valid, which is the leak that the mask stops.
	const grid = params.has('wall-leak')
		? new LightProbeGridData(
				baked.origin,
				baked.spacing,
				baked.counts,
				baked.coefficients,
				new Float32Array(baked.validity.length).fill(1),
				baked.skyVisibility,
			)
		: baked;
	if (params.has('wall-night'))
		scene.setEnvironment(environment, { rotation: [0, Math.PI / 2, 0], intensity: 0.25 });
	scene.setLightProbeGrid({
		texture: grid.toTexture(textures),
		origin: grid.origin,
		spacing: grid.spacing,
		counts: grid.counts,
	});
	return {};
});
