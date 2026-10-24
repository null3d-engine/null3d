// A beach and a pond whose water reads the copy of the opaque scene's depth and two textures of its
// own: a sheet of ripple rings in linear color and a field of foam flecks in sRGB. The water's
// surface function takes the gap between the sheet and the geometry behind it along the view ray,
// tints the shallow water with the ripples, fills the thinnest water with flecks of foam and fades
// the sheet to nothing over a band at the end of that gap. Both the soft shore and the two textures
// show, so a path that drops either one draws a different image: without the depth the whole sheet
// draws deep and no foam or shore shows, and without the textures the flecks and the ripples go.
import { defineSketch } from '@null3d/engine';

/** Texels on each side of both textures. */
const SIZE = 16;

const waterWgsl = /* wgsl */ `
struct Uniforms {
    shallow: vec3f,
    deep: vec3f,
    foam: vec3f,
    softness: f32,
}

var ripples: texture_2d<f32>;
var flecks: texture_2d<f32>;

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
    // The ripples ring across the sheet, and their slope tilts the surface, so the light moves over
    // the water between one ring and the next. They tint the water too, so a path that binds
    // neither texture draws a flatter sheet.
    let ring = textureSample(ripples, ripplesSampler, input.worldPosition.xz * 0.12).r;
    s.normal = normalize(vec3f(cos(ring * 6.2831853) * 0.22, 1.0, sin(ring * 6.2831853) * 0.22));
    s.baseColor = mix(material.shallow, material.deep, deep);
    s.baseColor *= mix(0.62, 1.5, ring);
    // Foam flecks lie on the shallowest water, and the texture's flecks break the band along the
    // shore.
    let fleck = textureSample(flecks, flecksSampler, input.worldPosition.xz * 0.3).r;
    let foam = (1.0 - smoothstep(0.0, material.softness * 0.9, gap)) * fleck;
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

/** Four numbers per texel of a texture of `SIZE` texels on each side, from `texel(x, y)`. */
function texels(texel: (x: number, y: number) => readonly number[]): Uint8Array {
	const data = new Uint8Array(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) data.set(texel(x, y), (y * SIZE + x) * 4);
	return data;
}

export default defineSketch(({ scene, materials, geometry, textures }) => {
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

	// Rings of a height that the surface bends the light with, on a grid of 16 texels.
	const ringMap = textures.fromData({
		width: SIZE,
		height: SIZE,
		colorSpace: 'linear',
		data: texels((x, y) => {
			const ring = Math.cos(Math.hypot(x - 7.5, y - 7.5) * 1.4) * 0.5 + 0.5;
			return [Math.round(ring * 255), 0, 0, 255];
		}),
	});
	// Flecks of foam in a broken field, which the thinnest water shows.
	const foamMap = textures.fromData({
		width: SIZE,
		height: SIZE,
		colorSpace: 'srgb',
		data: texels((x, y) => {
			const fleck = ((x * 5 + y * 3) % 7) / 7 + ((x * 3 + y * 5) % 5) / 10;
			const value = Math.round(Math.min(1, fleck * 1.6) * 255);
			return [value, value, value, 255];
		}),
	});

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
			textures: { ripples: ringMap, flecks: foamMap },
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
