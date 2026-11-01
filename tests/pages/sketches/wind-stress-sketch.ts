// A field of cards that reads the wind, with a load the page switches. The stress page draws no
// cards so frames keep their budget, then draws them all so the frame-budget governor must lighten
// the wind's settings, then takes them away so the governor raises the settings again. The camera
// stands still, so the only thing that can move the cards between two frames is the air.
import { defineSketch, type SketchContext } from '@null3d/engine';
import { createWind } from '@null3d/wind';

const params = new URL(import.meta.url).searchParams;
/** The cards the page asks for, and how far they stand from the middle. */
const REQUESTED = Number(params.get('cards') ?? '40000');
const GROUND = 36;

/** The card's material: a plane whose top leans with the air at its foot. */
const card = /* wgsl */ `
var wind: texture_2d_array<f32>;

struct Uniforms {
    // The field's box: its near corner across the ground, its width, and how much the cards lean.
    origin: vec2f,
    size: f32,
    sway: f32,
    // The first layer of the state that the grid's last run wrote.
    layer: i32,
}

fn vertexOffset(input: VertexInput) -> vec3f {
    let place = object.position + input.position;
    let uv = clamp((vec2f(place.x, place.z) - material.origin) / material.size, vec2f(0.0), vec2f(1.0));
    let air = textureSampleLevel(wind, windSampler, uv, material.layer, 0.0);
    // The air leans the card's top more than its foot, and the wind crosses the card's face.
    return vec3f(air.r, 0.0, air.b) * (material.sway * input.uv.y);
}
`;

export default defineSketch((ctx: SketchContext) => {
	const { scene, geometry, materials, page, quality } = ctx;
	// The page starts the engine at its preset, so the field is made at that row's grid and never
	// remade while the run lasts.
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

	const wind = createWind(ctx, { camera, box: 96 });

	// The device's instance limit counts the scene's own objects too, so the load keeps room for
	// them. A phone with WebGPU's default limits therefore takes a smaller load than the Mac.
	const CARDS = Math.max(1, Math.min(REQUESTED, ctx.engine.capabilities.maxInstances - 2048));

	scene.createMesh({
		mesh: geometry.plane({ width: GROUND * 2, height: GROUND * 2 }),
		material: materials.standard({ color: '#5f6b4a', roughness: 1 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	const cardValues = {
		origin: [wind.field.origin[0], wind.field.origin[1]] as [number, number],
	};
	const cardMaterial = materials.shader({
		wgsl: card,
		color: '#cfd6a8',
		roughness: 0.85,
		textures: { wind: wind.field.texture },
		uniforms: {
			origin: cardValues.origin,
			size: wind.field.size,
			sway: 0.12,
			layer: wind.field.texture.layer,
		},
	});
	// Each card carries enough segments to weigh on the vertex work of both the camera's pass and
	// the shadow pass, because the instance count alone is capped by the device.
	const cards = scene.createInstances(
		geometry.plane({ width: 0.3, height: 1.1, widthSegments: 2, heightSegments: 12 }),
		CARDS,
		{ material: cardMaterial, castShadows: true },
	);
	const positions = cards.positions as Float32Array;
	for (let i = 0; i < CARDS; i++) {
		const angle = i * 2.399_963_2;
		const radius = 3 + Math.sqrt(i / CARDS) * GROUND;
		positions[i * 3] = Math.cos(angle) * radius;
		positions[i * 3 + 1] = 0;
		positions[i * 3 + 2] = Math.sin(angle) * radius;
	}
	cards.markDirty();
	// The page starts with no load, so the light phase keeps its budget.
	cards.setActiveCount(0);

	page.onMessage((name, data) => {
		if (name === 'load') {
			const count = Number((data as { count?: number } | undefined)?.count ?? 0);
			cards.setActiveCount(Math.max(0, Math.min(CARDS, count)));
			return;
		}
		if (name === 'read') {
			// The governor's steps, the render scale and the wind's resolved settings tell the page
			// how far the governor has gone.
			page.post('state', {
				steps: quality.governor.steps,
				budgetScale: wind.budget.scale,
				budgetMs: wind.budget.ms,
				allowedMs: wind.budget.allowedMs,
				renderScale: quality.renderScale,
				preset: quality.preset,
				layer: wind.field.texture.layer,
				cards: CARDS,
				maxInstances: ctx.engine.capabilities.maxInstances,
				settings: { ...wind.settings },
			});
		}
	});

	return {
		onUpdate() {
			wind.update();
			cardValues.origin[0] = wind.field.origin[0];
			cardValues.origin[1] = wind.field.origin[1];
			cardMaterial.set(cardValues);
			cardMaterial.setUniform('layer', wind.field.texture.layer);
		},
	};
});
