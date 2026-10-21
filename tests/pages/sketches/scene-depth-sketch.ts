// A water-like surface whose custom material reads the copy of the opaque scene's depth. The
// water lies above a bed of boxes and a sand floor: it takes its color from the distance to the
// surface behind it, so the shallow edges stay pale and the deep middle darkens, and it takes a
// foam line where an opaque surface nearly touches it. Without the bound depth the distance reads
// the far plane everywhere, and the whole sheet draws its deepest color.
import { defineSketch } from '@null3d/engine';

/** The surface function: the water's color, its foam and its alpha come from the scene depth. */
const waterWgsl = /* wgsl */ `
struct Uniforms {
    shallow: vec3f,
    deep: vec3f,
    foam: vec3f,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let uv = input.fragCoord.xy / frame.resolution;
    let behind = sceneDistance(uv);
    let deep = smoothstep(1.2, 8.0, behind);
    s.baseColor = mix(material.shallow, material.deep, deep);
    // An opaque surface that nearly touches the sheet shows as foam along its edge.
    let near = 1.0 - smoothstep(0.15, 0.9, behind);
    s.baseColor = mix(s.baseColor, material.foam, near * 0.7);
    s.alpha = mix(0.45, 0.9, deep);
    s.roughness = 0.2;
    return s;
}
`;

/** The flat rotation that lays a plane, made in x and y, on the ground. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#0d1a22');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 45,
			near: 0.1,
			far: 80,
			position: [0, 6.5, 10],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#fff3e0', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.5 });

	const sand = materials.standard({ color: '#cbb27a', roughness: 0.9 });
	const bed = [
		{ position: [-2.6, 0.45, -1.2], color: '#b0533f', height: 0.9 },
		{ position: [0.2, 0.85, 0.4], color: '#4f7f9e', height: 1.7 },
		{ position: [2.8, 0.6, -2.2], color: '#8a6fae', height: 1.2 },
		{ position: [1.4, 1.15, 2.6], color: '#c99a3e', height: 2.3 },
	] as const;
	scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 30 }),
		material: sand,
		rotation: FLAT,
	});
	for (const { position, color, height } of bed) {
		scene.createMesh({
			mesh: geometry.box({ width: height, height, depth: height }),
			material: materials.standard({ color, roughness: 0.7 }),
			position,
		});
	}

	const water = materials.shader({
		wgsl: waterWgsl,
		sceneInputs: ['sceneDepth'],
		alphaMode: 'blend',
		depthWrite: false,
		roughness: 0.2,
		uniforms: { shallow: '#8fe0d2', deep: '#0b4a63', foam: '#f2fbff' },
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 30 }),
		material: water,
		position: [0, 1.1, 0],
		rotation: FLAT,
	});
});
