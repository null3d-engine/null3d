// A reflection pass under the sky: a red box at the left and a green box at the right stand on a
// plane at height 0, with a blue ball behind them and a yellow post that stands half below the
// plane. A magenta box lies wholly below the plane, under the part of it that the camera sees. The
// plane's custom material reads the pass's texture where it shows on the screen, and lights it as
// its surface's reflection. With the default, the plane is a smooth metal mirror, so each box's
// reflection hangs below it on its own side and the sky fills the rest. ?water ripples the plane
// with a few waves and gives it water's color and reflectance. ?quarter draws the reflection at a
// quarter of the render size, and ?every=3 draws it in one frame of three. The magenta box must
// never show: the pass clips everything below the plane, and the reflection spec checks it.
import { defineSketch } from '@null3d/engine';

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

const waterWgsl = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

struct Uniforms { strength: f32 }

/// The water's normal at a point of its surface: the slopes of a few sine waves that cross it.
fn ripples(p: vec2f, time: f32) -> vec3f {
    let waves = array<vec4f, 3>(
        vec4f(0.8, 0.6, 3.1, 1.3),
        vec4f(-0.5, 0.9, 4.7, 1.9),
        vec4f(0.95, -0.3, 7.3, 2.6),
    );
    var slope = vec2f(0.0);
    for (var k = 0u; k < 3u; k++) {
        let w = waves[k];
        let along = normalize(w.xy);
        slope += along * cos(dot(along, p) * w.z + time * w.w) * (0.25 / w.z);
    }
    return normalize(vec3f(-slope.x, 1.0, -slope.y));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.normal = ripples(input.worldPosition.xz, frame.time);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, s.normal.xz * material.strength);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 1.0);
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, textures, render }) => {
	scene.setBackground({ sky: { sunPosition: [0.4, 0.35, -0.85], cloudCoverage: 0 } });
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 2.6, 9],
		target: [0, 0.6, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.5], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.5 });

	const box = geometry.box({ width: 1.2, height: 1.6, depth: 1.2 });
	const solid = (color: string) => materials.standard({ color, roughness: 0.6 });
	scene.createMesh({ mesh: box, material: solid('#e03030'), position: [-2.4, 0.8, 0.5] });
	scene.createMesh({ mesh: box, material: solid('#30c040'), position: [2.4, 0.8, 0.5] });
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.9 }),
		material: solid('#3050e0'),
		position: [0, 0.9, -2.5],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 0.3, height: 3, depth: 0.3 }),
		material: solid('#e0c020'),
		position: [0.4, 0, 2],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 3, height: 1, depth: 3 }),
		material: materials.unlit({ color: '#ff00ff' }),
		position: [0, -1.2, 3],
	});

	const quarter = params.has('quarter');
	const every = Number(params.get('every') ?? 1);
	const pass = render.addPass({
		kind: 'reflection',
		writes: 'mirror',
		plane: { point: [0, 0, 0] },
		...(quarter ? { scale: 0.25 } : {}),
		...(every > 1 ? { every } : {}),
	});
	const mirror = textures.fromPass(pass);
	const water = params.has('water');
	const plane = water
		? materials.shader({
				wgsl: waterWgsl,
				color: '#0b2a33',
				roughness: 0.05,
				metalness: 0,
				uniforms: { strength: 0.04 },
				textures: { mirror },
			})
		: materials.shader({
				wgsl: mirrorWgsl,
				color: '#ffffff',
				roughness: 0,
				metalness: 1,
				textures: { mirror },
			});
	const floor = scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 30 }),
		material: plane,
	});
	floor.setRotationEuler(-Math.PI / 2, 0, 0);
	return {};
});
