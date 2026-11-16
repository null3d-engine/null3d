// A green sky layer over a lake, drawn in the main view and in a scene pass, so one frame shows the
// layer in two views and in the water that mirrors it. The main camera stands over the water,
// looking across it at two pillars. A second camera looks across the same water from the left, and
// its view fills a screen on the right of the main view. A reflection pass mirrors the main view
// across the water's plane, which the water's material shows. ?layer=off leaves the layer out, so
// the core sky and its own reflection stand in its place.
import { defineFeature, defineSketch } from '@null3d/engine';
import layer from './sky-layer-scene-pass.wgsl';

const params = new URL(import.meta.url).searchParams;
/** True when the module's own ?layer=off switch leaves the layer out. */
const WITH_LAYER = params.get('layer') !== 'off';

/** The description a sky layer needs: the background point, the draw kind and the three views. */
const DESCRIPTION = defineFeature({
	name: 'scene-pass-layer',
	frame: 'background',
	kind: 'draw',
	provides: ['sky'],
	views: ['main', 'scenePass', 'reflection'],
});

/** The water's surface: the reflection pass's texture, where the surface shows on the screen. */
const waterWgsl = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, vec2f(0.0));
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 1.0);
    return s;
}
`;

/** The screen's place in the main view, and its width and height in world units. */
const SCREEN = { position: [4.6, 2.6, 5] as [number, number, number], width: 3.6, height: 2.0 };

export default defineSketch(({ scene, geometry, materials, textures, render, quality, post }) => {
	quality.set({ minRenderScale: 1 });
	post.set({ toneMapping: 'none' });
	// No sun disc and no clouds: the sky shows the layer's colour, or the core sky's without it.
	scene.setBackground({
		sky: { sunPosition: [0.4, 0.5, -0.8], cloudCoverage: 0, showSunDisc: false },
	});
	// The main camera sees the screen and its frame; the passes draw the scene's own layer alone,
	// and a screen never draws in a pass whose texture it shows, so the screen stays out of both.
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		near: 0.5,
		far: 300,
		position: [0, 3, 14],
		target: [0, 2.5, -6],
	});
	camera.setLayers(0b11);
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.5], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.5 });

	// The water: a reflection pass mirrors the camera's view across the water's plane, and the
	// water's material shows that texture.
	const reflection = render.addPass({
		kind: 'reflection',
		writes: 'mirror',
		plane: { point: [0, 0, 0] },
		layers: 0b01,
	});
	const water = materials.shader({
		wgsl: waterWgsl,
		color: '#0b2a33',
		roughness: 0.05,
		metalness: 0,
		textures: { mirror: textures.fromPass(reflection) },
	});
	const lake = scene.createMesh({
		mesh: geometry.plane({ width: 80, height: 80 }),
		material: water,
	});
	lake.setRotationEuler(-Math.PI / 2, 0, 0);

	// Two pillars at the far side of the water, one red and one blue, which the reflection shows.
	const pillar = geometry.box({ width: 1, height: 1, depth: 1 });
	scene.createMesh({
		mesh: pillar,
		material: materials.standard({ color: '#c04a30', roughness: 0.6 }),
		position: [-4, 6, -10],
		scale: [1.2, 12, 1.2],
	});
	scene.createMesh({
		mesh: pillar,
		material: materials.standard({ color: '#3050c0', roughness: 0.6 }),
		position: [3, 5, -12],
		scale: [1.2, 10, 1.2],
	});

	// A second camera looks across the water from the left, its view mostly sky, and a scene pass
	// draws it into a texture. A screen on the right of the main view shows that texture.
	const second = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.5,
		far: 300,
		position: [-16, 7, 2],
		target: [2, 12, -8],
	});
	const feed = render.addPass({
		kind: 'scene',
		camera: second,
		writes: 'feed',
		size: [512, 288],
		layers: 0b01,
		reads: ['mirror'],
	});
	scene.createMesh({
		mesh: geometry.plane({ width: SCREEN.width, height: SCREEN.height }),
		material: materials.unlit({ map: textures.fromPass(feed) }),
		position: [SCREEN.position[0], SCREEN.position[1], SCREEN.position[2] + 0.11],
	});
	const frame = scene.createMesh({
		mesh: geometry.box({ width: SCREEN.width + 0.2, height: SCREEN.height + 0.2, depth: 0.2 }),
		material: materials.standard({ color: '#14161c', roughness: 0.5 }),
		position: SCREEN.position,
	});
	frame.setLayers(0b10);

	// A layer that stands still, so the held frame shows it in every view that draws the sky.
	if (WITH_LAYER) scene.setSkyLayer(DESCRIPTION, { wgsl: layer, refresh: 0 });
	return {};
});
