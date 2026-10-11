// Screen-space reflections on a floor: a red box at the left and a green box at the right stand on
// a smooth steel floor, with a blue ball and a bright panel behind them, under a dark sky. ?ssr
// turns the reflections on, at half the render size or at ?ssrscale=0.25. Without it, the floor
// reflects only the environment, which the sketch leaves dark, so the floor stays dark. ?rough
// makes the floor rough, so the reflections blur; ?wet makes it a dark, smooth plastic floor, which
// reflects little straight down and much at a low angle, as wet asphalt does. ?ao turns ambient
// occlusion on too, which draws on the same grid. ?planar mirrors the floor's left half with a
// planar reflection pass, which wins over the screen's reflection there. ?glass puts a glass ball
// in front, which draws through the copy of the opaque colors that the reflections read too.
// ?scale= draws at that render scale.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;

/** The floor's left half takes the planar reflection, the right half the screen's. */
const planarWgsl = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, vec2f(0.0));
    let left = select(0.0, 1.0, input.worldPosition.x < 0.0);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, left);
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, post, quality, render, textures }) => {
	if (params.has('ssr')) {
		quality.set({ ssrScale: params.get('ssrscale') === '0.25' ? 0.25 : 0.5, ssrSteps: 64 });
		post.set({ ssr: { maxDistance: 30, thickness: 0.6 } });
	}
	if (params.has('ao')) {
		quality.set({ aoScale: 0.5 });
		post.set({ ao: { radius: 0.5 } });
	}
	const scale = params.get('scale');
	if (scale !== null)
		quality.set({ minRenderScale: Number(scale), maxRenderScale: Number(scale), governor: false });
	scene.setBackground('#0d1420');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 2.2, 8],
		target: [0, 0.8, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.6], intensity: 2.2 });
	scene.createAmbientLight({ intensity: 0.35 });

	const box = geometry.box({ width: 1.2, height: 1.6, depth: 1.2 });
	const solid = (color: string) => materials.standard({ color, roughness: 0.6 });
	scene.createMesh({ mesh: box, material: solid('#e03030'), position: [-2.2, 0.8, 0.8] });
	scene.createMesh({ mesh: box, material: solid('#30c040'), position: [2.2, 0.8, 0.8] });
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.9 }),
		material: solid('#3050e0'),
		position: [0, 0.9, -2],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 5, height: 1.2, depth: 0.2 }),
		material: materials.unlit({ color: '#fff2c0' }),
		position: [0, 3.2, -4],
	});
	if (params.has('glass'))
		scene.createMesh({
			mesh: geometry.sphere({ radius: 0.6 }),
			material: materials.standard({ roughness: 0.05, transmission: 1, thickness: 1.2, ior: 1.5 }),
			position: [0.4, 0.6, 3],
		});

	const rough = params.has('rough');
	const wet = params.has('wet');
	const floorLook = wet
		? { color: '#151719', roughness: 0.03, metalness: 0 }
		: { color: '#c8ccd0', roughness: rough ? 0.3 : 0.04, metalness: 1 };
	const floorMaterial = params.has('planar')
		? materials.shader({
				wgsl: planarWgsl,
				...floorLook,
				textures: {
					mirror: textures.fromPass(
						render.addPass({ kind: 'reflection', writes: 'mirror', plane: { point: [0, 0, 0] } }),
					),
				},
			})
		: materials.standard(floorLook);
	const floor = scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 30 }),
		material: floorMaterial,
	});
	floor.setRotationEuler(-Math.PI / 2, 0, 0);
	return {};
});
