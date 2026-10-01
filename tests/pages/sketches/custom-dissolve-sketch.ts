// The README's dissolve, for its image test: a surface function with uniforms and the mask alpha
// mode. Noise from the library decides where each sphere has dissolved, the uniform progress
// grows from left to right, and a glowing edge in the uniform color runs along the cut.
import { defineSketch } from '@null3d/engine';

const dissolveWgsl = /* wgsl */ `
#import null3d::noise::{fbm2}

struct Uniforms { progress: f32, edgeColor: vec3f }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let n = fbm2(input.uv * 8.0, 4u) * 0.5 + 0.5;
    s.alpha = step(material.progress, n);
    let edge = 1.0 - smoothstep(0.0, 0.05, n - material.progress);
    s.emissive = material.edgeColor * edge * 4.0;
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#20242a');
	const camera = scene.createPerspectiveCamera({
		fov: 35,
		near: 0.1,
		far: 50,
		position: [0, 0, 10],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.5, -0.7, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const sphere = geometry.sphere({ radius: 1, widthSegments: 48, heightSegments: 24 });
	[0, 0.3, 0.5, 0.7].forEach((progress, k) => {
		const dissolve = materials.shader({
			wgsl: dissolveWgsl,
			color: '#c0c4cc',
			roughness: 0.5,
			alphaMode: 'mask',
			alphaCutoff: 0.5,
			doubleSided: true,
			uniforms: { progress, edgeColor: '#ff6a00' },
		});
		scene.createMesh({ mesh: sphere, material: dissolve, position: [-3.6 + k * 2.4, 0, 0] });
	});
});
