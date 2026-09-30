// The built-in values of custom materials, for their image test, held at 1.5 seconds. Spheres in a
// row share one WGSL: each takes its hue from its own origin (object.position), a stripe that
// moves with frame.time, and a checker in world space (input.worldPosition). A far plane fades by
// its distance from camera.position, and a band across the render target shows frame.resolution.
// A wave offsets vertices by frame.time, and a sphere far from the world's origin keeps the same
// checker as one near it.
import { defineSketch } from '@null3d/engine';

const builtins = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let hue = fract(object.position.x * 0.137 + 0.5);
    let tint = vec3f(hue, 1.0 - hue, 0.5);
    let stripe = step(0.5, fract(input.uv.y * 4.0 - frame.time * 0.5));
    let cell = floor(input.worldPosition * 2.0);
    let checker = (i32(cell.x + cell.y + cell.z) & 1) == 0;
    s.baseColor = tint * select(0.4, 1.0, checker);
    s.emissive = vec3f(0.3, 0.2, 0.05) * stripe;
    let distance = length(input.worldPosition - camera.position);
    s.baseColor *= clamp(20.0 / distance, 0.2, 1.0);
    return s;
}
`;

const screen = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let across = (clip.x / clip.w) * 0.5 + 0.5;
    s.emissive = vec3f(step(0.5, fract(across * frame.resolution.x / 40.0))) * 0.6;
    s.baseColor = vec3f(0.1);
    return s;
}
`;

const wave = /* wgsl */ `
fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f(0.0, 0.0, sin(input.uv.x * 12.0 + frame.time * 2.0) * 0.12);
}
`;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#20242a');
	const camera = scene.createPerspectiveCamera({
		fov: 35,
		near: 0.1,
		far: 100,
		position: [0, 0, 12],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.5, -0.7, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const sphere = geometry.sphere({ radius: 0.6, widthSegments: 32, heightSegments: 16 });
	const shared = materials.shader({ wgsl: builtins, roughness: 0.6 });
	for (let k = 0; k < 5; k++)
		scene.createMesh({ mesh: sphere, material: shared, position: [-4 + k * 2, 1.6, 0] });

	const plane = geometry.plane({ width: 4, height: 1.2 });
	const far = scene.createMesh({ mesh: plane, material: shared, position: [-2.5, -0.2, -20] });
	far.setScale(4, 4, 1);
	const band = materials.shader({ wgsl: screen });
	scene.createMesh({ mesh: plane, material: band, position: [2.5, -0.1, 0] });

	const strip = geometry.plane({ width: 4, height: 0.8, widthSegments: 64 });
	const waving = materials.shader({ wgsl: wave, color: '#4a8cff', flatShading: true });
	scene.createMesh({ mesh: strip, material: waving, position: [-2.2, -1.9, 0] });
	scene.createMesh({ mesh: sphere, material: shared, position: [2.5, -1.9, 0] });
});
