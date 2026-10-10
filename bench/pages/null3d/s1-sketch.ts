// The null3d version of S1, the swarm: every instance moves every frame, and the camera orbits.
// The `blend` switch makes the boxes see through, for the allocation sample of the transparent pass.
// The `animated` switch adds that many animated characters, for the allocation sample of the
// animator. The `morphed` switch adds that many morphed spheres whose weights change every frame,
// for the allocation sample of morph targets. The `grading` switch loads a color grading table and turns the vignette on, then
// changes the table's intensity and the vignette every frame, for the allocation sample of
// post.set and the final pass's grading. The `sprites` switch draws the swarm as blended sprites
// instead of boxes, for the allocation sample of sprite batches, and the `lines` switch as dashed
// line segments, for the allocation sample of line batches. The `labels` switch adds that many
// objects, each with an HTML label that moves on the canvas as the camera orbits, for the
// allocation sample of the labels. The `ao` switch turns ambient occlusion on at half size, and
// changes its intensity every frame, for the allocation sample of its passes. The `bloom` switch
// turns bloom on and changes its intensity every frame, for the allocation sample of its chain's
// steps, whose settings the core then writes again in each frame. The `outline` switch
// adds outlined boxes, turns outlines on with a hidden line, and changes the line's width every
// frame, for the allocation sample of the outline's mask pass, the final pass's line and post.set.
// The `tileShadows` switch adds two point lights and two spot lights that cast shadows, with
// casters that circle them, so tiles of the shadow atlas draw again every frame, for the
// allocation sample of the tiles' marks and their cap.
// The `environment` switch lights the swarm with the built-in room, and turns it and changes its
// intensity every frame, for the allocation sample of scene.setEnvironment and the environment's
// light. The `hemisphere` switch adds two hemisphere lights, one upright and one tilted, and
// changes their intensities every frame, for the allocation sample of the frame's sum of them.
// The `effects` switch adds two custom effects, one of which reads the scene's depth, and
// changes a color uniform of each every frame through an array changed in place, for the
// allocation sample of post.setEffectUniform and the effects' passes. The `dof` switch turns depth
// of field on, focused on a point that sweeps through the swarm every frame, for the allocation
// sample of post.set's focus point and depth of field's steps.
// The `reflection` switch puts rippled water under the swarm, which a reflection pass mirrors the
// swarm and the background into, for the allocation sample of the pass and for its cost: the
// camera orbits, so the mirrored view moves every frame, and the ripples move with the sketch
// time. `reflection=full`, `half` and `quarter` give the pass that share of the render size, and
// the switch alone takes the preset's.
// The `transmission` switch puts clear water that lets light through under the swarm, for the
// allocation sample and the cost of the copy of the opaque colors that it samples, and of its
// shading.
// The `decode` switch loads KTX2 textures and a meshopt model without end, for the frame times of
// the decoders' work in the engine's workers.
// The page's `shadows=<n>` gives the sun shadows in that many cascades, and the `batchShadows`
// switch makes the swarm's rows cast and receive them, for the cost of a large batch in the shadow
// passes and for the allocation sample of its rows as moving casters. The `rowValues` switch gives
// every row a color and values that change every frame, read by a custom material that sways and
// tints each box, for the allocation sample of the row values' uploads.
import { defineSketch, type Environment, type SketchContext, type Texture } from '@null3d/engine';
import { GRADING_LUTS } from '../../scenes/grading';
import { BACKGROUND, S1_BOB_HEIGHT, S1_EXTENT, s1Camera, VIEW_LIGHTS } from '../../scenes/spec';
import { createAnimatedCrowd, readAnimated } from './crowd';
import { createMorphedRow, readMorphed } from './morphed';
import { followPath, frameCount, readCount, readShadows, setUpView } from './sketch-common';
import { createLineSwarm, createSpriteSwarm, createSwarm } from './swarm';

export default defineSketch(async (context) => {
	const { time } = context;
	const cascades = readShadows(import.meta.url);
	const moveCamera = followPath(
		setUpView(context, VIEW_LIGHTS, BACKGROUND, { cascades }),
		s1Camera,
	);
	const switches = new URL(import.meta.url).searchParams;
	const count = readCount(import.meta.url);
	const poseSwarm = switches.has('sprites')
		? await createSpriteSwarm(context, count)
		: switches.has('lines')
			? await createLineSwarm(context, count)
			: createSwarm(context, count, true, undefined, switches.has('blend'), {
					shadows: switches.has('batchShadows'),
					rowValues: switches.has('rowValues'),
				}).pose;
	const animate = createAnimatedCrowd(context, readAnimated(import.meta.url));
	const morph = createMorphedRow(context, readMorphed(import.meta.url));
	createLabels(context, Number(switches.get('labels') ?? 0));
	const grading = switches.has('grading');
	const outlined = switches.has('outline');
	if (outlined) createOutlined(context);
	const moveCasters = switches.has('tileShadows') ? createTileShadows(context) : undefined;
	const reflection = switches.get('reflection');
	if (reflection !== null) createWater(context, reflection);
	if (switches.has('transmission')) createClearWater(context);
	// One settings object, changed in place, so the sketch's own code allocates nothing per frame.
	const vignette = { size: 1, intensity: 1 };
	const settings = { lutIntensity: 1, vignette };
	const line = { width: 2 };
	const outlineSettings = { outline: line };
	if (grading)
		void context.assets.loadLut(GRADING_LUTS.warm).then((lut) => context.post.set({ lut }));
	if (switches.has('decode')) void decodeWithoutEnd(context);
	const ao = switches.has('ao');
	const occlusion = { ao: { intensity: 1 } };
	if (ao) context.quality.set({ aoScale: 0.5 });
	const bloom = switches.has('bloom');
	const glow = { bloom: { intensity: 0.15 } };
	// Depth of field's focus point, changed in place, so a frame's call allocates no array.
	const focus: [number, number, number] = [0, 0, 0];
	const lens = { dof: { aperture: 2, focusPoint: focus } };
	const dof = switches.has('dof');
	const effects = switches.has('effects');
	const tint = effects
		? context.post.addEffect({ wgsl: TINT, uniforms: { color: [1, 0.95, 0.9], amount: 0.5 } })
		: undefined;
	const haze = effects
		? context.post.addEffect({ wgsl: HAZE, uniforms: { color: '#b0c4d8', density: 0.002 } })
		: undefined;
	// The effects' colors, changed in place, so a frame's calls allocate no array.
	const warm: [number, number, number] = [1, 0.95, 0.9];
	const mist: [number, number, number] = [0.43, 0.55, 0.69];
	// The environment's options, changed in place, as the grading's settings are.
	const turn: [number, number, number] = [0, 0, 0];
	const lighting = { intensity: 1, rotation: turn };
	let room: Environment | undefined;
	// The sky's settings, changed in place: its sun rises and sets, and its clouds drift.
	// `sky=clear` draws it without clouds, and `sky=still` keeps its sun and clouds where they are.
	// `sky=light` lights the swarm with the sky's environment too, which refreshes in stages as
	// the sun moves, for the allocation sample of the sky map's stages and its diffuse light.
	// `sky=room` draws the built-in room as the background instead, which reads one texel a pixel,
	// and `sky=texture` draws a texture made from data, which covers the view with one triangle
	// where the room and the sky draw a box around the camera. `backgroundFirst` adds a small box
	// whose opaque material writes no depth, which makes any background draw before the objects
	// with no depth test, and `extraBox` adds the same box with a material that writes depth.
	const skyMode = switches.get('sky');
	const sky = skyMode !== null && skyMode !== 'room' && skyMode !== 'texture';
	if (skyMode === 'texture') context.scene.setBackground(createGradient(context));
	if (switches.has('backgroundFirst')) addSmallBox(context, false);
	if (switches.has('extraBox')) addSmallBox(context, true);
	const sun: [number, number, number] = [0, 0.2, -1];
	const skySettings = { sunPosition: sun, time: 0, cloudCoverage: skyMode === 'clear' ? 0 : 0.4 };
	const skyBackground = { sky: skySettings };
	if (sky) context.scene.setBackground(skyBackground);
	if (skyMode === 'room')
		void context.assets.builtinEnvironment('room').then((loaded) => {
			context.scene.setBackground(loaded);
		});
	if (skyMode === 'light')
		void context.assets.skyEnvironment().then((loaded) => {
			context.scene.setEnvironment(loaded);
		});
	if (switches.has('environment'))
		void context.assets.builtinEnvironment('room').then((loaded) => {
			room = loaded;
		});
	const hemispheres = switches.has('hemisphere') ? createHemispheres(context) : undefined;
	const pose = (t: number) => {
		poseSwarm(t);
		moveCamera(t);
		animate(t);
		morph(t);
		moveCasters?.(t);
		if (outlined) {
			line.width = 2 + Math.sin(t);
			context.post.set(outlineSettings);
		}
		if (hemispheres) {
			hemispheres[0].setIntensity(0.3 + 0.1 * Math.sin(t));
			hemispheres[1].setIntensity(0.2 + 0.1 * Math.cos(t));
		}
		if (room) {
			turn[1] = 0.5 * t;
			lighting.intensity = 0.75 + 0.25 * Math.sin(t);
			context.scene.setEnvironment(room, lighting);
		}
		if (sky && skyMode !== 'still') {
			sun[1] = 0.2 + 0.15 * Math.sin(t);
			skySettings.time = t;
			context.scene.setBackground(skyBackground);
		}
		if (ao) {
			occlusion.ao.intensity = 0.75 + 0.25 * Math.sin(t);
			context.post.set(occlusion);
		}
		if (bloom) {
			glow.bloom.intensity = 0.15 + 0.05 * Math.sin(t);
			context.post.set(glow);
		}
		if (dof) {
			focus[0] = 20 * Math.sin(0.7 * t);
			focus[2] = 20 * Math.cos(0.5 * t);
			context.post.set(lens);
		}
		if (tint && haze) {
			warm[2] = 0.9 + 0.1 * Math.sin(t);
			context.post.setEffectUniform(tint, 'color', warm);
			mist[0] = 0.43 + 0.05 * Math.cos(t);
			context.post.setEffectUniform(haze, 'color', mist);
		}
		if (!grading) return;
		settings.lutIntensity = 0.5 + 0.5 * Math.sin(t);
		vignette.size = 1 + 0.25 * Math.cos(t);
		context.post.set(settings);
	};
	pose(time.now);
	const frames = frameCount(context, import.meta.url);
	return {
		onUpdate() {
			pose(time.now);
			if (frames) Atomics.add(frames, 0, 1);
		},
	};
});

/** A custom effect that tints each pixel toward a color. */
const TINT = /* wgsl */ `
struct Uniforms { color: vec3f, amount: f32 }

fn effect(input: EffectInput) -> vec4f {
    return vec4f(mix(input.color.rgb, input.color.rgb * uniforms.color, uniforms.amount), input.color.a);
}
`;

/** A custom effect that fades each pixel toward a color by its distance from the camera. */
const HAZE = /* wgsl */ `
struct Uniforms { color: vec3f, density: f32 }

fn effect(input: EffectInput) -> vec4f {
    let fade = 1.0 - exp(-effectDistance(input.uv) * uniforms.density);
    return vec4f(mix(input.color.rgb, uniforms.color * input.color.a, fade), input.color.a);
}
`;

/**
 * Two hemisphere lights for the `hemisphere` switch: a blue sky over brown ground, upright, and a
 * warm one tilted an eighth of a turn about X.
 */
function createHemispheres({ scene }: SketchContext) {
	const tilt = Math.sin(Math.PI / 8);
	return [
		scene.createHemisphereLight({ skyColor: '#9cc8ff', groundColor: '#806040' }),
		scene.createHemisphereLight({
			skyColor: '#ffd9a8',
			groundColor: '#202830',
			rotation: [tilt, 0, 0, Math.cos(Math.PI / 8)],
		}),
	] as const;
}

/** The folder of the KTX2 sample model, whose 19 textures the `decode` switch transcodes. */
const LAMP = '/samples/sources/khronos/StainedGlassLamp/glTF-KTX-BasisU';
/** The meshopt sample model, which the `decode` switch loads after each round of textures. */
const MESHOPT_CUBE = '/samples/sources/khronos/MeshoptCubeTest/glTF-Meshopt/MeshoptCubeTest.gltf';

/**
 * Loads the KTX2 sample model's textures, all at once, and the meshopt sample model, round after
 * round until the page closes. The textures go as soon as they arrive. The frames meanwhile show
 * what the decoders' work in the engine's workers costs the frame loop.
 */
async function decodeWithoutEnd({ assets }: SketchContext): Promise<void> {
	const gltf = (await (await fetch(`${LAMP}/StainedGlassLamp.gltf`)).json()) as {
		images: { uri: string }[];
	};
	for (;;) {
		const textures = await Promise.all(
			gltf.images.map(({ uri }) => assets.loadTexture(`${LAMP}/${uri}`)),
		);
		for (const texture of textures) texture.destroy();
		await assets.loadGltf(MESHOPT_CUBE);
	}
}

/** The water's height, below the lowest boxes of the swarm and their bobbing. */
const WATER_HEIGHT = -S1_EXTENT - S1_BOB_HEIGHT - 2;

/** The reflection pass's share of the render size, by the `reflection` switch's value. */
const REFLECTION_SCALES = { full: 1, half: 0.5, quarter: 0.25 } as const;

/** Water that ripples with the sketch time, and reads the reflection where it shows on the screen. */
const WATER = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz * 0.15;
    let slope = vec2f(cos(p.x + frame.time), cos(p.y * 1.3 + frame.time * 1.7)) * 0.08;
    s.normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, s.normal.xz * 0.05);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 1.0);
    return s;
}
`;

/** Adds the `reflection` switch's water under the swarm, and the pass that it reflects. */
function createWater(
	{ scene, geometry, materials, render, textures }: SketchContext,
	size: string,
) {
	const scale = REFLECTION_SCALES[size as keyof typeof REFLECTION_SCALES];
	const pass = render.addPass({
		kind: 'reflection',
		writes: 'water',
		plane: { point: [0, WATER_HEIGHT, 0] },
		...(scale ? { scale } : {}),
	});
	const material = materials.shader({
		wgsl: WATER,
		color: '#0b2a33',
		roughness: 0.05,
		textures: { mirror: textures.fromPass(pass) },
	});
	const water = scene.createMesh({
		mesh: geometry.plane({ width: 1200, height: 1200 }),
		material,
		position: [0, WATER_HEIGHT, 0],
	});
	water.setRotationEuler(-Math.PI / 2, 0, 0);
}

/** Adds the `transmission` switch's clear water under the swarm, which lets the light below through. */
function createClearWater({ scene, geometry, materials }: SketchContext) {
	const water = scene.createMesh({
		mesh: geometry.plane({ width: 1200, height: 1200 }),
		material: materials.standard({
			roughness: 0.05,
			ior: 1.33,
			transmission: 1,
			thickness: 4,
			attenuationColor: '#3a8a90',
			attenuationDistance: 20,
		}),
		position: [0, WATER_HEIGHT, 0],
	});
	water.setRotationEuler(-Math.PI / 2, 0, 0);
}

/** The number of outlined boxes that the `outline` switch adds. */
const OUTLINED_BOXES = 16;

/**
 * Adds outlined boxes on a ring around the swarm's center, half of them behind the swarm from the
 * camera's path, and turns outlines on with a hidden line. Its colors are set once, so a frame's
 * call changes only the width.
 */
function createOutlined({ scene, geometry, materials, post }: SketchContext): void {
	const mesh = geometry.box();
	const material = materials.standard({ color: '#c05050' });
	for (let k = 0; k < OUTLINED_BOXES; k++) {
		const angle = (k / OUTLINED_BOXES) * Math.PI * 2;
		const position: [number, number, number] = [Math.cos(angle) * 12, 2, Math.sin(angle) * 12];
		scene.createMesh({ mesh, material, position, name: `outlined${k}` }).setOutlined(true);
	}
	post.set({ outline: { color: '#ffaa00', hiddenColor: '#3070ff', width: 2 } });
}

/** Where the `tileShadows` switch's lights stand: two point lights, then two spot lights. */
const SHADOWED_LIGHTS: readonly (readonly [number, number, number])[] = [
	[-10, 3, 0],
	[10, 3, 0],
	[0, 6, -10],
	[0, 6, 10],
];

/** The casters that circle each of the `tileShadows` switch's lights. */
const CASTERS_PER_LIGHT = 3;

/**
 * Adds the `tileShadows` switch's lights, a ground that receives their shadows, and casters that
 * circle the lights. Returns the step that moves the casters to their places at time `t`.
 */
function createTileShadows({ scene, geometry, materials }: SketchContext): (t: number) => void {
	const material = materials.standard({ color: '#9aa0a8' });
	scene.createMesh({
		mesh: geometry.box({ width: 60, height: 0.2, depth: 60 }),
		material,
		position: [0, -0.1, 0],
		receiveShadows: true,
	});
	for (const [k, [x, y, z]] of SHADOWED_LIGHTS.entries()) {
		const position: [number, number, number] = [x, y, z];
		if (k < 2) scene.createPointLight({ position, range: 10, intensity: 30, castShadows: true });
		else
			scene.createSpotLight({
				position,
				target: [x, 0, z],
				range: 12,
				angle: 0.7,
				intensity: 60,
				castShadows: true,
			});
	}
	const mesh = geometry.box({ width: 0.8, height: 0.8, depth: 0.8 });
	const casters = Array.from({ length: SHADOWED_LIGHTS.length * CASTERS_PER_LIGHT }, () =>
		scene.createMesh({ mesh, material, castShadows: true, receiveShadows: true, dynamic: true }),
	);
	// Index reads, not destructuring: an iterator would allocate in every frame.
	return (t) => {
		for (let k = 0; k < casters.length; k++) {
			const light = SHADOWED_LIGHTS[k % SHADOWED_LIGHTS.length] as readonly number[];
			const angle = t + (k * Math.PI * 2) / casters.length;
			const x = (light[0] as number) + 2.5 * Math.cos(angle);
			const z = (light[2] as number) + 2.5 * Math.sin(angle);
			casters[k]?.setPosition(x, 1, z);
		}
	};
}

/**
 * Adds `count` objects on a ring, each with a label `label-0` onward. The camera orbits, so every
 * label moves on the canvas in every frame, and the objects need no code per frame.
 */
function createLabels({ scene, ui }: SketchContext, count: number): void {
	for (let k = 0; k < count; k++) {
		const angle = (k / count) * Math.PI * 2;
		const anchor = scene.createGroup({
			position: [Math.cos(angle) * 20, 5 + (k % 8), Math.sin(angle) * 20],
		});
		ui.trackLabel(anchor, `label-${k}`, { offset: [0, 1, 0] });
	}
}

/** Adds a small unlit box at the swarm's center, whose material writes depth or not. */
function addSmallBox({ scene, geometry, materials }: SketchContext, depthWrite: boolean): void {
	scene.createMesh({
		mesh: geometry.box({ width: 0.5, height: 0.5, depth: 0.5 }),
		material: materials.unlit({ color: '#ffffff', depthWrite }),
	});
}

/** A texture of a smooth gradient, made from data, about as large as the view it fills. */
function createGradient({ textures }: SketchContext): Texture {
	const width = 1024;
	const height = 512;
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 4;
			data[at] = (x * 255) / (width - 1);
			data[at + 1] = (y * 255) / (height - 1);
			data[at + 2] = 160;
			data[at + 3] = 255;
		}
	return textures.fromData({ width, height, data, colorSpace: 'srgb' });
}
