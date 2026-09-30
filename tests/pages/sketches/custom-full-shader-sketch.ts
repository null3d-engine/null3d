// A full shader as a custom material, for its image test, held at 1 second. A hologram glows at
// its rims, with scan lines that move with the sketch time, on spheres and on instances of a batch;
// each instance scrolls its lines from its own origin. A second full shader colors a quad by its
// vertex colors, which only meshes with colors draw. The standard material's sphere beside them
// shows the lights that the full shaders ignore.
import { defineSketch } from '@null3d/engine';

const hologram = /* wgsl */ `
#import null3d::builtins::{fill_builtins, frame, object}
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish, relative_position}
#import null3d::mesh::{world_normal}

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) relative: vec3f,
    @location(1) normal: vec3f,
    @location(2) @interpolate(flat, either) origin: vec3f,
}

@vertex
fn vs(@location(0) position: vec3f, @location(1) normal: vec3f, i: InstanceIn) -> Varyings {
    let found = find_instance(i);
    var out: Varyings;
    out.relative = relative_position(found, position);
    out.clip = clip_position(found, position);
    out.normal = world_normal(found, normal);
    out.origin = relative_position(found, vec3f(0.0));
    return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    fill_builtins(in.origin);
    let rim = 1.0 - abs(dot(normalize(in.normal), normalize(-in.relative)));
    let height = in.relative.y + object.position.x * 0.2;
    let lines = step(0.5, fract(height * 8.0 - frame.time));
    let glow = vec3f(0.2, 0.8, 1.0) * (pow(rim, 2.0) * 1.5 + lines * 0.25);
    return finish(glow, in.clip.xy);
}
`;

const painted = /* wgsl */ `
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish}

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) color: vec4f,
}

@vertex
fn vs(@location(0) position: vec3f, @location(5) color: vec4f, i: InstanceIn) -> Varyings {
    let found = find_instance(i);
    return Varyings(clip_position(found, position), color);
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    return finish(in.color.rgb, in.clip.xy);
}
`;

/** A quad in the XY plane, facing +Z, with a linear color at each corner. */
const QUAD = {
	positions: [-0.8, -0.8, 0, 0.8, -0.8, 0, 0.8, 0.8, 0, -0.8, 0.8, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	colors: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#10141a');
	const camera = scene.createPerspectiveCamera({
		fov: 35,
		near: 0.1,
		far: 50,
		position: [0, 0, 12],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.5, -0.7, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const sphere = geometry.sphere({ radius: 0.9, widthSegments: 48, heightSegments: 24 });
	const ghost = materials.shader({ wgsl: hologram });
	scene.createMesh({ mesh: sphere, material: ghost, position: [-3.5, 1.3, 0] });
	scene.createMesh({ mesh: sphere, material: ghost, position: [-1.2, 1.3, 0] });
	scene.createMesh({ mesh: sphere, material: materials.standard(), position: [1.2, 1.3, 0] });

	const small = geometry.sphere({ radius: 0.35, widthSegments: 24, heightSegments: 12 });
	const batch = scene.createInstances(small, 5, { material: ghost });
	for (let k = 0; k < 5; k++) batch.positions.set([-4 + k * 1.1, -1.6, 0], k * 3);
	batch.markDirty();

	const quad = geometry.fromArrays(QUAD);
	const colored = materials.shader({ wgsl: painted });
	scene.createMesh({ mesh: quad, material: colored, position: [3.6, 1.3, 0] });
	// A mesh without colors does not draw with a shader that reads them.
	scene.createMesh({ mesh: geometry.plane(), material: colored, position: [3.6, -1.6, 0] });
});
