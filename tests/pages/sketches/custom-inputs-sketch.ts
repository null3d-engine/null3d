// The inputs of custom materials that three.js's ShaderMaterial gives its shaders, for their image
// test. Each check draws green where the engine's values agree and red where they do not.
// - Two batches of ten rows, a static one and a dynamic one, take a hue from `input.instance`, so
//   each shows a rainbow from left to right on both of WebGL2's data textures. The dynamic batch
//   and the middle box match a uniform with their `shaderId`, as `object.id`, and glow.
// - A tilted, unevenly scaled box checks, in thirds: `camera.projection * camera.view` against
//   `camera.viewProjection`, the world matrix's origin against `object.position`, and the normal
//   matrix against the surface's normal.
// - Two quads stripe along `input.uv1`: one mesh has a second set at right angles to its first,
//   and one has none, so it stripes along its first set.
// - The back wall shows a checker of 24 pixels from `input.fragCoord`, warm in the top half of the
//   target on every GPU path, and darkens with depth between `camera.near` and `camera.far`.
import { defineSketch } from '@null3d/engine';

const rows = /* wgsl */ `
struct Uniforms { pickedMesh: u32, pickedBatch: u32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let hue = f32(input.instance) / 10.0 * 6.0;
    let rainbow = saturate(abs(fract(hue / 6.0 + vec3f(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0);
    let picked = object.id == material.pickedMesh || object.id == material.pickedBatch;
    s.baseColor = rainbow;
    s.emissive = rainbow * select(0.0, 0.8, picked);
    return s;
}
`;

const checks = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = vec4f(input.relativePosition, 1.0);
    let clip = (camera.projection * camera.view * p) - (camera.viewProjection * p);
    let origin = (object.worldMatrix * vec4f(0.0, 0.0, 0.0, 1.0)).xyz + camera.position;
    let world = mat3x3f(object.worldMatrix[0].xyz, object.worldMatrix[1].xyz, object.worldMatrix[2].xyz);
    let mesh = transpose(world) * input.normal;
    let turned = normalize(object.normalMatrix * normalize(mesh));
    let third = u32(saturate(input.uv.x) * 2.999);
    var ok = length(clip) < 1e-3;
    if third == 1u { ok = length(origin - object.position) < 1e-3; }
    if third == 2u { ok = dot(turned, input.normal) > 0.999; }
    s.baseColor = vec3f(0.05);
    s.emissive = select(vec3f(1.0, 0.1, 0.1), vec3f(0.1, 0.9, 0.2), ok);
    return s;
}
`;

const stripes = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = vec3f(0.08);
    s.emissive = vec3f(0.9, 0.8, 0.3) * step(0.5, fract(input.uv1.x * 5.0));
    return s;
}
`;

const wall = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let cell = floor(input.fragCoord.xy / 24.0);
    let checker = select(0.35, 0.6, (i32(cell.x + cell.y) & 1) == 0);
    let top = input.fragCoord.y < frame.resolution.y * 0.5;
    let depth = -(camera.view * vec4f(input.relativePosition, 1.0)).z;
    let fade = 1.0 - saturate((depth - camera.near) / (camera.far - camera.near));
    s.baseColor = select(vec3f(0.3, 0.45, 0.8), vec3f(0.9, 0.5, 0.3), top) * checker * fade;
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#20242a');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 40, near: 0.5, far: 30, position: [0, 0, 10] }),
	);
	scene.createDirectionalLight({ direction: [-0.4, -0.6, -1], color: '#ffffff', intensity: 2 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.6 });

	const wallMesh = scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 18 }),
		material: materials.shader({ wgsl: wall }),
		position: [0, 0, -6],
	});
	wallMesh.setRotationEuler(0, 0.35, 0);

	const cube = geometry.box({ width: 0.5, height: 0.5, depth: 0.5 });
	const material = materials.shader({ wgsl: rows, roughness: 0.6 });
	const batches = [false, true].map((dynamic, k) => {
		const batch = scene.createInstances(cube, 10, { material, dynamic });
		for (let row = 0; row < 10; row++) batch.positions.set([-4.5 + row, 2.6 - k * 0.8, 0], row * 3);
		batch.markDirty();
		return batch;
	});
	const boxes = [-1, 0, 1].map((x) =>
		scene.createMesh({ mesh: cube, material, position: [x * 0.8 - 3.2, -0.6, 0] }),
	);
	material.set({ pickedMesh: boxes[1]?.shaderId ?? 0, pickedBatch: batches[1]?.shaderId ?? 0 });

	const checked = scene.createMesh({
		mesh: geometry.box({ width: 1, height: 1, depth: 1 }),
		material: materials.shader({ wgsl: checks }),
		position: [0, -0.5, 0],
	});
	checked.setScale(1.8, 1.2, 0.8);
	checked.setRotationEuler(0.5, 0.6, 0.2);

	// The same quad twice: with second coordinates at right angles to the first, and without.
	const corners = {
		positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
		indices: [0, 1, 2, 0, 2, 3],
	};
	const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
	const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
	const crossed = geometry.fromArrays({ ...corners, normals, uvs, uvs1: [0, 0, 0, 1, 1, 1, 1, 0] });
	const single = geometry.fromArrays({ ...corners, normals, uvs });
	const striped = materials.shader({ wgsl: stripes });
	scene.createMesh({ mesh: crossed, material: striped, position: [2.6, -0.6, 0] });
	scene.createMesh({ mesh: single, material: striped, position: [2.6, -2.9, 0] });
});
