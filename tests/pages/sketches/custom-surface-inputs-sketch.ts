// The inputs that a masked custom material's surface function reads where it shades and where it
// cuts its shadow and its motion (M3-V2): one card sways by its vertex offset over a ground that
// receives its shadow.
//
// ?plain leaves the surface's alpha as the card's shape alone. The default multiplies it by values
// that hold across the card where the surface shades: the object's world matrix, the camera's
// pixel, its target size, its matrices and planes, the face that the triangle shows, the side its
// normal faces and the direction toward the camera. A pass that gives the surface any of them
// another value cuts the mask there instead, so the plain and the gated cards draw the same
// picture while every pass sees the same inputs.
//
// ?motion draws the motion view, whose holes carry the alpha that the motion build gives it, and
// ?noshadows turns the sun's shadows off, which shows that the shadow draws at all.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** True to leave the surface's alpha as the card's shape, without the gates. */
const PLAIN = params.has('plain');
/** True to draw the motion view. */
const MOTION = params.has('motion');
/** True to turn the sun's shadows off. */
const NO_SHADOWS = params.has('noshadows');

// Both materials sway by their vertex offset, so both draw in the motion pass, and both cut the
// card's shape from its texture coordinates. Only the gated one reads the surface's other inputs.
const GATED = /* wgsl */ `
/// The card's shape: a disc that stands clear of the card's edges.
fn shape(uv: vec2f) -> f32 {
    return step(length(uv - vec2f(0.5)), 0.42);
}

/// A bend that rises to the card's top, which gives the card and its shadow a motion.
fn vertexOffset(input: VertexInput) -> vec3f {
    let bend = sin(frame.time * 1.8 + input.uv.y * 1.2) * 0.7 * input.uv.y;
    return vec3f(0.0, bend, 0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.alpha = shape(input.uv);
    // Each value holds across the card where the surface shades, so it leaves the mask as it is.
    // A pass that reads another value cuts the mask there. The card stands in the camera's pixels
    // beyond the shadow map's width, so a caster that reads the map's own pixel cuts the whole
    // shadow.
    let moved = select(0.0, 1.0, object.worldMatrix[3].x > 1.5);
    let pixel = select(0.0, 1.0, input.fragCoord.x > 520.0);
    // The camera draws this picture wider than the shadow map, and the motion target is its size.
    let targetSize = select(0.0, 1.0, frame.resolution.x > 600.0);
    // The scene camera's matrices and planes, which a shadow pass would otherwise take from the
    // light or read as zero.
    let planes = select(0.0, 1.0, camera.near > 0.05 && camera.far > 1.0);
    let matrices = select(
        0.0,
        1.0,
        abs(camera.projection[0][0]) > 0.01
            && camera.view[3][3] > 0.5
            && camera.viewProjection[3][3] < 0.5,
    );
    let front = select(0.0, 1.0, input.frontFacing);
    let normal = select(0.0, 1.0, input.normal.x > 0.25);
    let facing = select(0.0, 1.0, input.viewDirection.z > 0.65);
    s.alpha *= moved * pixel * targetSize * planes * matrices * front * normal * facing;
    return s;
}
`;

const PLAIN_MASK = /* wgsl */ `
/// The card's shape: a disc that stands clear of the card's edges.
fn shape(uv: vec2f) -> f32 {
    return step(length(uv - vec2f(0.5)), 0.42);
}

/// A bend that rises to the card's top, which gives the card and its shadow a motion.
fn vertexOffset(input: VertexInput) -> vec3f {
    let bend = sin(frame.time * 1.8 + input.uv.y * 1.2) * 0.7 * input.uv.y;
    return vec3f(0.0, bend, 0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.alpha = shape(input.uv);
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, debug, quality }) => {
	// Both pictures must draw at the canvas's size: the pixel gate reads the camera's pixels and
	// the target's width.
	quality.set({ minRenderScale: 1, maxRenderScale: 1 });
	if (MOTION) debug.view('motion');
	scene.setBackground('#26333d');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.1,
			far: 40,
			position: [0, 1.7, 6],
			target: [0, 0.95, 0],
		}),
	);
	scene.createDirectionalLight({
		direction: [-0.35, -1, -0.6],
		color: '#fff3dc',
		intensity: 3.2,
		castShadows: !NO_SHADOWS,
		// The card stands in the camera's pixels beyond this map's width, so the caster's pixel
		// gate tells the camera's pixel from the map's.
		...(NO_SHADOWS ? {} : { shadow: { cascades: 1, mapSize: 512, distance: 20 } }),
	});
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.3 });
	scene.createMesh({
		mesh: geometry.box({ width: 14, height: 0.1, depth: 14 }),
		material: materials.standard({ color: '#7d8468' }),
		position: [0, -0.05, 0],
		receiveShadows: true,
	});
	// The card faces the camera and the sun, turned so that its world normal points along +x as
	// well as +z. Its mesh normal points along +z, so a pass that reads the mesh's own normal reads
	// another value.
	const turn = 20 * (Math.PI / 180);
	const material = materials.shader({
		wgsl: PLAIN ? PLAIN_MASK : GATED,
		color: '#ffffff',
		roughness: 0.8,
		doubleSided: true,
		alphaMode: 'mask',
		alphaCutoff: 0.5,
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 1, height: 2.1, widthSegments: 4, heightSegments: 7 }),
		material,
		position: [3.2, 1.05, 0],
		rotation: [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)],
		castShadows: true,
	});
});
