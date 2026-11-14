// The smallest scene that shows the WebGL2 reflection-pass fault: a ground that reads a reflection
// pass, a blended mesh, and one particle system. ?pass=0, ?blend=0 and ?particles=0 leave each part
// out, so the fault reduces to the pair it names.
import { defineSketch } from '@null3d/engine';
import { createParticles } from '@null3d/particles';

const params = new URL(import.meta.url).searchParams;
const PASS = params.get('pass') !== '0';
const BLEND = params.get('blend') !== '0';
const PARTICLES = params.get('particles') !== '0';

const mirrorGround = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

struct Uniforms { share: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, vec2f(0.0));
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, material.share);
    return s;
}
`;

const blended = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.alpha = 0.5;
    return s;
}
`;

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, render, textures } = ctx;
	scene.setBackground('#070a10');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 3.2, 7.5], target: [0, 0.4, -1] }),
	);
	scene.createDirectionalLight({ direction: [-0.4, -0.8, -0.5], intensity: 2.4 });
	scene.createAmbientLight({ intensity: 0.6 });

	let ground = materials.standard({ color: '#30343a', roughness: 0.8 });
	if (PASS) {
		const pass = render.addPass({
			kind: 'reflection',
			writes: 'mirror',
			plane: { point: [0, 0, 0] },
			scale: 0.5,
			every: 1,
		});
		ground = materials.shader({
			wgsl: mirrorGround,
			color: '#30343a',
			roughness: 0.8,
			uniforms: { share: 1 },
			textures: { mirror: textures.fromPass(pass) },
		});
	}
	scene.createMesh({
		mesh: geometry.plane({ width: 60, height: 60 }),
		material: ground,
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	if (BLEND)
		scene.createMesh({
			mesh: geometry.plane({ width: 2, height: 1.2 }),
			material: materials.shader({
				wgsl: blended,
				color: '#9fc4ff',
				alphaMode: 'blend',
				depthWrite: false,
			}),
			position: [0, 1.5, 3],
		});
	const spray = PARTICLES
		? await createParticles(ctx, {
				position: [0, 0.2, 0.5],
				rate: 10,
				lifetime: 0.5,
				size: [0.05, 0.1],
				colors: '#dfeeff',
			})
		: null;
	return {
		onUpdate() {},
		onLateUpdate() {
			if (spray) spray.update();
		},
	};
});
