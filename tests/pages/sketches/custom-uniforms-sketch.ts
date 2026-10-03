// Custom materials with uniforms, for their image test. One WGSL draws every sphere: rings along
// the first texture coordinates, in the uniforms' tint, count and width, with an emissive glow.
// The top row takes the uniforms' first values, from left to right: the defaults of 0, a tint as a
// color, more rings, and wider rings. The bottom row changes them with set() after creation, and
// changes a standard value with them.
import { defineSketch, type ShaderValues, type UniformValues } from '@null3d/engine';

const rings = /* wgsl */ `
struct Uniforms {
    tint: vec3f,
    width: f32,
    count: u32,
    offset: vec2f,
    glow: vec4f,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let t = fract((input.uv.y + material.offset.y) * f32(max(material.count, 1u)));
    let ring = step(1.0 - material.width, t);
    s.baseColor = mix(s.baseColor, material.tint, ring);
    s.emissive += material.glow.rgb * material.glow.a * ring;
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#20242a');
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
	const sphere = geometry.sphere({ radius: 0.6, widthSegments: 32, heightSegments: 16 });

	const firsts: UniformValues<typeof rings>[] = [
		{},
		{ tint: '#ff6a00', width: 0.5, count: 4 },
		{ tint: [0.1, 0.8, 0.3], width: 0.5, count: 10 },
		{ tint: '#4080ff', width: 0.8, count: 4, glow: [0.2, 0.4, 1, 0.5] },
	];
	firsts.forEach((uniforms, k) => {
		const material = materials.shader({ wgsl: rings, color: '#c0c4cc', roughness: 0.6, uniforms });
		scene.createMesh({ mesh: sphere, material, position: [-3.3 + k * 2.2, 1.5, 0] });
	});

	const changed: ShaderValues<typeof rings>[] = [
		{ tint: '#ffffff', width: 0.3, count: 6, offset: [0, 0.08] },
		{ tint: '#ff2020', width: 0.5, count: 3, roughness: 0.2, color: '#303440' },
		{ glow: [1, 0.6, 0.1, 1.5], width: 0.25, count: 8, tint: '#000000' },
	];
	changed.forEach((values, k) => {
		const material = materials.shader({ wgsl: rings, color: '#8098d0', uniforms: { count: 2 } });
		material.set(values);
		scene.createMesh({ mesh: sphere, material, position: [-2.2 + k * 2.2, -1.4, 0] });
	});
});
