// Three planes side by side, each drawn by a custom material from WGSL in another form: a surface
// function in a `.wgsl` file on the left, a surface function in a tagged template literal in the
// middle, and a full shader in a tagged template literal on the right. Each glows in one pure
// color, which the hot update test changes in the WGSL.
import { defineSketch } from '@null3d/engine';
import tint from './tint.wgsl';

const glow = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = vec3f(0.0);
    s.emissive = vec3f(0.0, 0.0, 1.0);
    return s;
}
`;

const flat = /* wgsl */ `
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish}

@vertex
fn vs(@location(0) position: vec3f, i: InstanceIn) -> @builtin(position) vec4f {
    return clip_position(find_instance(i), position);
}

@fragment
fn fs(@builtin(position) clip: vec4f) -> @location(0) vec4f {
    return finish(vec3f(0.0, 1.0, 0.0), clip.xy);
}
`;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#000000');
	const camera = scene.createPerspectiveCamera({
		fov: 30,
		near: 0.1,
		far: 20,
		position: [0, 0, 5.6],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const plane = geometry.plane();
	const surfaces = [
		materials.shader({ wgsl: tint, uniforms: { strength: 1 } }),
		materials.shader({ wgsl: glow }),
		materials.shader({ wgsl: flat }),
	];
	surfaces.forEach((material, k) => {
		scene.createMesh({ mesh: plane, material, position: [(k - 1) * 3, 0, 0] });
	});
});
