// The wind add-on's own page, which the listing check opens and the image tests draw. A field of
// cards stands in for plants: each card reads the air at its own place in every vertex, so a gust
// that crosses the field makes the cards lean and a body that moves through them leaves a wake.
//
// Switches: `?frozen=1` takes the gust and the swirl out, so the air is a steady wind and nothing
// moves between two times. `?still=1` stops the body after a second, so its wake stays where it
// made it. `?camera=still` holds the camera, so the air alone moves the picture.
import { defineSketch, type SketchContext } from '@null3d/engine';
import { createWind } from '../src/index.ts';

const params = new URL(import.meta.url).searchParams;
const FROZEN = params.get('frozen') === '1';
const STILL = params.get('still') === '1';
/** A still camera leaves the field as the only thing that can move the picture. */
const STILL_CAMERA = params.get('camera') === 'still';

/** The cards: how many, and how far they stand from the middle. */
const CARDS = 3_000;
const GROUND = 36;
/** The body that moves through the air, and how often it shoves it. */
const BODY_SPEED = 0.9;
const BODY_PUSH_MS = 250;
/**
 * Where the camera starts: across the wind, so a card's lean shows on screen instead of pointing at
 * the eye.
 */
const START = Math.PI / 2;

/** The card's material: a plane whose top leans with the air at its foot. */
const card = /* wgsl */ `
var wind: texture_2d_array<f32>;

struct Uniforms {
    // The field's box: its near corner across the ground, its width, and how much the cards lean.
    origin: vec2f,
    size: f32,
    sway: f32,
    // How much slower the air is at the ground.
    ground: f32,
}

// <wind-sample>
/// The air at a world place, as the texture holds it: the wind across the ground in red and blue,
/// the wind's rise in green, and its speed in alpha. The box's near corner and width place the
/// world. A place outside the box reads the box's edge.
fn wind_sample(world: vec3f, origin: vec2f, size: f32) -> vec4f {
    let uv = clamp((vec2f(world.x, world.z) - origin) / size, vec2f(0.0), vec2f(1.0));
    return textureSampleLevel(wind, windSampler, uv, 0, 0.0);
}
// </wind-sample>

fn vertexOffset(input: VertexInput) -> vec3f {
    let place = object.position + input.position;
    let air = wind_sample(place, material.origin, material.size);
    // The air slows near the ground, and a card's top leans more than its foot.
    let height = 1.0 - material.ground * exp(-max(place.y, 0.0) / 2.0);
    return vec3f(air.r, 0.0, air.b) * (material.sway * height * input.uv.y);
}
`;

export default defineSketch((ctx: SketchContext) => {
	const { scene, geometry, time } = ctx;
	scene.setBackground({ sky: { sunPosition: [0.4, 0.5, -0.6], cloudCoverage: 0.2 } });
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		near: 0.5,
		far: 400,
		position: [0, 6.5, 22],
		target: [0, 1.2, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.5, -1, -0.3], intensity: 3, castShadows: true });
	scene.createAmbientLight({ intensity: 0.45 });

	const wind = createWind(ctx, {
		camera,
		box: 96,
		grid: 64,
		air: FROZEN ? { gustStrength: 0, swirl: 0 } : { gustSpeed: 16 },
	});

	scene.createMesh({
		mesh: geometry.plane({ width: GROUND * 2, height: GROUND * 2 }),
		material: ctx.materials.standard({ color: '#5f6b4a', roughness: 1 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// The box follows the camera, so the cards' uniforms follow the box. One object and one pair
	// of numbers hold them, and the material copies what `set` gives it.
	const cardValues = { origin: [wind.field.origin[0], wind.field.origin[1]] as [number, number] };
	const cardMaterial = ctx.materials.shader({
		wgsl: card,
		color: '#cfd6a8',
		roughness: 0.85,
		textures: { wind: wind.field.texture },
		uniforms: {
			origin: cardValues.origin,
			size: wind.field.size,
			sway: 0.12,
			ground: FROZEN ? 0 : 0.5,
		},
	});
	const cards = scene.createInstances(
		geometry.plane({ width: 0.3, height: 1.1, heightSegments: 4 }),
		CARDS,
		{
			material: cardMaterial,
			castShadows: true,
		},
	);
	const positions = cards.positions as Float32Array;
	for (let i = 0; i < CARDS; i++) {
		// A ring of cards with a hole in the middle, so the body has room to pass through.
		const angle = i * 2.399_963_2;
		const radius = 3 + Math.sqrt(i / CARDS) * GROUND;
		positions[i * 3] = Math.cos(angle) * radius;
		positions[i * 3 + 1] = 0;
		positions[i * 3 + 2] = Math.sin(angle) * radius;
	}
	cards.markDirty();

	const material = ctx.materials.standard({ color: '#c4562f', roughness: 0.5, metalness: 0.2 });
	const body = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.9 }),
		material,
		dynamic: true,
		castShadows: true,
	});
	let pushed = 0;
	let sent = false;
	let elapsed = 0;

	return {
		onUpdate(dt: number) {
			elapsed += dt;
			// The frozen page holds the body and the camera still, so the only thing that could
			// move the cards is the air. The still page lets the body go until a second in, so its
			// wake stays behind it.
			const moving = !FROZEN && (!STILL || elapsed < 1);
			const turn = (FROZEN || STILL ? Math.min(elapsed, 1) : elapsed) * BODY_SPEED;
			const x = Math.cos(turn) * 9;
			const z = Math.sin(turn) * 9;
			body.setPosition(x, 1.4, z);
			// The body shoves the air as it goes, so the wake trails behind it.
			if (moving && time.now - pushed > BODY_PUSH_MS / 1000) {
				wind.push([x, z], 4);
				pushed = time.now;
			}
			// One gust arrives from upwind, so the cards change as it passes over them.
			if (!FROZEN && !sent && time.now > 0) {
				wind.gust([-20, -14]);
				sent = true;
			}
			wind.update();
			cardValues.origin[0] = wind.field.origin[0];
			cardValues.origin[1] = wind.field.origin[1];
			cardMaterial.set(cardValues);
			// The camera circles slowly, so the cost gate measures frames that change.
			const view = START + (FROZEN || STILL_CAMERA ? 0 : 0.12 * elapsed);
			camera.setPosition(Math.cos(view) * 22, 6.5, Math.sin(view) * 22);
			camera.lookAt(0, 1.2, 0);
		},
	};
});
