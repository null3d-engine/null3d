// Custom materials with surface functions, for their image test. The top row pairs a standard
// material with a custom material whose surface function returns `defaultSurface(input)` as it
// is, for three sets of standard options: each pair must look the same. The bottom row draws
// surface functions that change the look: stripes along the first texture coordinates with an
// emissive glow, two materials that share one surface function with different colors, a
// flat-shaded one, and a double-sided plane seen from behind, which a surface function colors by
// the face it shows.
import { defineSketch } from '@null3d/engine';

/** A surface function that keeps the material's own look. */
const plain = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    return defaultSurface(input);
}
`;

/** Stripes along u, which glow, over the material's own look. */
const stripes = /* wgsl */ `
#import null3d::math::{remap}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let stripe = step(0.5, fract(input.uv.x * 12.0));
    s.baseColor = mix(s.baseColor, vec3f(0.05, 0.05, 0.08), stripe);
    s.emissive += vec3f(1.0, 0.35, 0.05) * stripe * remap(input.uv.y, 0.0, 1.0, 0.2, 1.0);
    s.roughness = mix(s.roughness, 0.2, stripe);
    return s;
}
`;

/** Rings of the base color and white by the height of the surface, which darkens toward the bottom. */
const rings = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let ring = step(0.5, fract(input.uv.y * 6.0));
    s.baseColor = mix(s.baseColor, vec3f(1.0), ring) * mix(0.3, 1.0, input.uv.y);
    return s;
}
`;

/** Green on the front face and orange on the back face, whatever the material's color. */
const faces = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = select(vec3f(1.0, 0.4, 0.05), vec3f(0.1, 0.8, 0.2), input.frontFacing);
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

	const looks = [
		{ color: '#d8a860', metalness: 1, roughness: 0.3 },
		{ color: '#8098d0', roughness: 0.5, flatShading: true },
		{ color: '#303440', emissive: '#ff6a20', emissiveIntensity: 1.5 },
	];
	looks.forEach((look, k) => {
		const x = -4.2 + k * 3;
		scene.createMesh({ mesh: sphere, material: materials.standard(look), position: [x, 1.5, 0] });
		const custom = materials.shader({ ...look, wgsl: plain });
		scene.createMesh({ mesh: sphere, material: custom, position: [x + 1.4, 1.5, 0] });
	});

	const striped = materials.shader({ color: '#c0c4cc', roughness: 0.7, wgsl: stripes });
	scene.createMesh({ mesh: sphere, material: striped, position: [-4.2, -1.4, 0] });
	const red = materials.shader({ color: '#e04040', roughness: 0.5, wgsl: rings });
	const blue = materials.shader({ color: '#4060e0', roughness: 0.5, wgsl: rings });
	scene.createMesh({ mesh: sphere, material: red, position: [-2.4, -1.4, 0] });
	scene.createMesh({ mesh: sphere, material: blue, position: [-0.9, -1.4, 0] });
	const faceted = materials.shader({ color: '#60c0a0', flatShading: true, wgsl: rings });
	scene.createMesh({ mesh: sphere, material: faceted, position: [0.8, -1.4, 0] });

	// Both planes face away from the camera: the double-sided one shows its back face.
	const plane = geometry.plane({ width: 1.2, height: 1.2 });
	const both = materials.shader({ doubleSided: true, wgsl: faces });
	const back = scene.createMesh({ mesh: plane, material: both, position: [2.6, -1.4, 0] });
	back.setRotationEuler(0.3, Math.PI - 0.4, 0);
	const front = materials.shader({ doubleSided: true, wgsl: faces });
	const facing = scene.createMesh({ mesh: plane, material: front, position: [4.2, -1.4, 0] });
	facing.setRotationEuler(0.3, 0.4, 0);
});
