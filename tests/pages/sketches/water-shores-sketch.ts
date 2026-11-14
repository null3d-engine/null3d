// A beach and a pond whose water meets a bed that rises to the surface, with a rounded island and two
// stones. The water's surface function reads the copy of the opaque scene's depth and takes the gap
// between the water's surface and the geometry behind it along the view ray: the water thins, foams
// and fades to nothing over a band at the end of that gap, so the shoreline is soft rather than a hard
// polygon edge. Without the copy the gap reads as the far plane, the whole sheet draws its deep color
// and no foam shows.
import { defineSketch } from '@null3d/engine';

const waterWgsl = /* wgsl */ `
#import null3d::noise::{value2}

struct Uniforms {
    shallow: vec3f,
    deep: vec3f,
    foam: vec3f,
    softness: f32,
}

/// The distance in front of the camera of a depth value, as sceneDistance converts the copy's.
fn distance_of(depth: f32) -> f32 {
    let near = engine_frame.camera_range.x;
    let far = engine_frame.camera_range.y;
    // Both GPU paths store reversed depth, so 1 lies at the near plane and 0 at the far plane.
    if engine_frame.camera_position.w > 0.5 {
        return near * far / (near + depth * (far - near));
    }
    return far - depth * (far - near);
}

/// The water's normal at a point: the slopes of a few sine waves, which stay still in a held frame.
fn ripples(p: vec2f) -> vec3f {
    let slope = vec2f(cos(p.x * 2.7 + 1.3), cos(p.y * 3.9)) * 0.05;
    return normalize(vec3f(-slope.x, 1.0, -slope.y));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let uv = input.fragCoord.xy / frame.resolution;
    // The water's surface and the opaque scene behind the pixel, both as distances from the camera.
    let here = distance_of(input.fragCoord.z);
    let behind = sceneDistance(uv);
    // The water's thickness along the view ray. It reaches zero at the waterline, where the bank
    // rises through the surface, and grows as the bed falls away behind the water.
    let gap = max(behind - here, 0.0);
    let deep = smoothstep(0.05, 1.8, gap);
    s.normal = ripples(input.worldPosition.xz);
    s.baseColor = mix(material.shallow, material.deep, deep);
    // Foam lies on the shallowest water, broken into flecks along the shore.
    let flecks = 0.45 + 0.55 * value2(input.worldPosition.xz * 1.5);
    let foam = (1.0 - smoothstep(0.0, material.softness * 0.5, gap)) * flecks;
    s.baseColor = mix(s.baseColor, material.foam, foam * 0.85);
    s.roughness = mix(0.08, 0.75, foam);
    // The soft shore: the water fades to nothing as its gap closes, so it ends in a band against the
    // bed instead of on the polygon's edge.
    s.alpha = smoothstep(0.0, material.softness, gap) * mix(0.6, 0.92, deep);
    return s;
}
`;

/** The flat rotation that lays a plane, made in x and y, on the ground. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
/** How far the bed rises for each meter toward the camera: a gentle beach. */
const BEACH = 0.105;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#12222b');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 45,
			near: 0.1,
			far: 120,
			position: [0.6, 0.95, 4.2],
			target: [0.1, -0.15, -2.2],
		}),
	);
	scene.createDirectionalLight({ direction: [-0.6, -1, -0.4], color: '#fff3e0', intensity: 3 });
	scene.createAmbientLight({ color: '#cfe8f2', intensity: 0.55 });

	// The bed rises through the water at the foot of the frame, so a long shoreline runs across it.
	const bed = scene.createMesh({
		mesh: geometry.plane({ width: 40, height: 40 }),
		material: materials.standard({ color: '#b9a887', roughness: 0.95 }),
	});
	bed.setRotationEuler(-Math.PI / 2 - Math.atan(BEACH), 0, 0);
	// A dark hill hides the far edge of the water.
	scene.createMesh({
		mesh: geometry.box({ width: 40, height: 5, depth: 4 }),
		material: materials.standard({ color: '#40513a', roughness: 0.95 }),
		position: [0, 1.5, -16],
	});
	// A rounded island, whose shore curves across the water.
	scene.createMesh({
		mesh: geometry.sphere({ radius: 2.4, widthSegments: 48, heightSegments: 32 }),
		material: materials.standard({ color: '#6d7d4e', roughness: 0.9 }),
		position: [1.8, -1.75, -3.2],
	});
	// Two stones in the shallows, each with a ring of soft water around it.
	for (const [x, y, z, radius] of [
		[-1.9, -0.42, -0.5, 0.7],
		[0.7, -0.32, -1.2, 0.55],
	] as const)
		scene.createMesh({
			mesh: geometry.sphere({ radius, widthSegments: 32, heightSegments: 20 }),
			material: materials.standard({ color: '#7d766a', roughness: 0.85 }),
			position: [x, y, z],
		});

	scene.createMesh({
		mesh: geometry.plane({ width: 40, height: 40 }),
		material: materials.shader({
			wgsl: waterWgsl,
			sceneInputs: ['sceneDepth'],
			alphaMode: 'blend',
			depthWrite: false,
			roughness: 0.08,
			metalness: 0,
			uniforms: { shallow: '#9fe3d6', deep: '#0b4a63', foam: '#f4fbff', softness: 0.9 },
		}),
		position: [0, 0, 0],
		rotation: FLAT,
	});
});
