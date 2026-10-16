// The null3d version of S1, the swarm: every instance moves every frame, and the camera orbits.
// The `blend` switch makes the boxes see through, for the allocation sample of the transparent pass.
// The `animated` switch adds that many animated characters, for the allocation sample of the
// animator, and the `inertial` switch makes the characters that play one clip switch clips by
// inertial transitions, for the allocation sample of those transitions. The `morphed` switch adds that many morphed spheres whose weights change every frame,
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
// The `areaLights` switch adds eight rectangle lights, two of which show images, and four tube
// lights, which circle the swarm and change their intensities every frame, for the allocation
// sample of area lights.
// The `effects` switch adds two custom effects, one of which reads the scene's depth, and
// changes a color uniform of each every frame through an array changed in place, for the
// allocation sample of post.setEffectUniform and the effects' passes. The `dof` switch turns depth
// of field on, focused on a point that sweeps through the swarm every frame, for the allocation
// sample of post.set's focus point and depth of field's steps. The `exposure` switch turns automatic
// exposure on, and changes its compensation every frame, for the allocation sample of post.set's
// automatic exposure and the meter's steps. The `fog` switch gives the scene height fog with the
// volumetric fog on, for the allocation sample of its steps, whose block the core writes again in
// every frame as the camera orbits.
// The `reflection` switch puts rippled water under the swarm, which a reflection pass mirrors the
// swarm and the background into, for the allocation sample of the pass and for its cost: the
// camera orbits, so the mirrored view moves every frame, and the ripples move with the sketch
// time. `reflection=full`, `half` and `quarter` give the pass that share of the render size, and
// the switch alone takes the preset's.
// The `transmission` switch puts clear water that lets light through under the swarm, for the
// allocation sample and the cost of the copy of the opaque colors that it samples, and of its
// shading.
// The `ssr` switch puts a polished floor under the swarm and turns screen-space reflections on, for
// the allocation sample and the cost of their steps, the copy of the opaque colors that they read,
// and the floor's shading: the camera orbits, so the reflections move every frame. `ssr=half` and
// `ssr=quarter` give their grid that share of the render size, `ssr=off` keeps the floor with the
// reflections off, and the switch alone takes the preset's.
// The `coatSheen` switch gives the swarm's boxes a clear coat and a sheen, for the allocation sample
// and the cost of their shading: `coatSheen=coat` and `coatSheen=sheen` give one of them, and the switch
// alone both.
// The `weighted` switch puts a column of smoke over the swarm's middle: puffs of the weighted
// blending in a sprite batch that rise and swell in every frame, for the allocation sample and the
// cost of the camera's weighted layer. `weighted=sorted` gives the same smoke the normal blending,
// which the transparent pass sorts, for the cost of one against the other.
// The `decals` switch puts a ground under the swarm with a batch of decals on it, which turn every
// frame, for the cost of the decal pass and the allocation sample of its rows. The tall boxes of
// the decals reach the lowest boxes of the swarm too. `decals=off` puts the ground alone, the
// other side of the decals' cost.
// The `passes` switch adds a full-screen pass that reads the scene's color at half the render
// size and softens it, and a custom effect that adds the pass's texture as a glow, then changes
// the pass's uniform every frame, for the allocation sample of render.setPassUniform, the pass's
// block and the effect's texture.
// The `terrain` switch puts the terrain add-on's ground under the swarm, whose quadtree follows
// the orbiting camera in every frame, and the `impostors` switch a field of the impostors
// add-on's cards around it, which pick their views from the camera in every frame, for the
// allocation samples of the add-ons' steps.
// The `decode` switch loads KTX2 textures and a meshopt model without end, for the frame times of
// the decoders' work in the engine's workers.
// The page's `shadows=<n>` gives the sun shadows in that many cascades, and the `batchShadows`
// switch makes the swarm's rows cast and receive them, for the cost of a large batch in the shadow
// passes and for the allocation sample of its rows as moving casters. The `rowValues` switch gives
// every row a color and values that change every frame, read by a custom material that sways and
// tints each box, for the allocation sample of the row values' uploads. The `levels` switch gives
// the boxes levels of detail, for the allocation sample of the rows' choice of a level and of the
// fading bands between levels. The `setters` switch calls, in every frame, each setter that a
// sketch may call per frame, with fractions and colors: the lights', a line batch's, the camera's
// field of view, the fog and the background color. A material's `set` is called once, at setup.
import {
	defineSketch,
	type Environment,
	type PerspectiveCamera,
	type SketchContext,
	type Texture,
} from '@null3d/engine';
import { createParticles, type ParticleSystem, particleTextures } from '@null3d/particles';
import { GRADING_LUTS } from '../../scenes/grading';
import { BACKGROUND, S1_BOB_HEIGHT, S1_EXTENT, s1Camera, VIEW_LIGHTS } from '../../scenes/spec';
import { createImpostorField, createTerrainGround } from './addons';
import { createAnimatedCrowd, readAnimated } from './crowd';
import { createMorphedRow, readMorphed } from './morphed';
import { followPath, frameCount, readCount, readShadows, setUpView } from './sketch-common';
import { createLineSwarm, createSpriteSwarm, createSwarm, type SwarmCoatSheen } from './swarm';

export default defineSketch(async (context) => {
	const { time } = context;
	const cascades = readShadows(import.meta.url);
	const camera = setUpView(context, VIEW_LIGHTS, BACKGROUND, { cascades });
	const moveCamera = followPath(camera, s1Camera);
	const switches = new URL(import.meta.url).searchParams;
	const count = readCount(import.meta.url);
	const poseSwarm = switches.has('sprites')
		? await createSpriteSwarm(context, count)
		: switches.has('lines')
			? await createLineSwarm(context, count)
			: createSwarm(context, count, true, undefined, switches.has('blend'), {
					shadows: switches.has('batchShadows'),
					rowValues: switches.has('rowValues'),
					levels: switches.has('levels'),
					layers: readCoatSheen(switches.get('coatSheen')),
				}).pose;
	const animate = createAnimatedCrowd(
		context,
		readAnimated(import.meta.url),
		switches.has('inertial'),
	);
	const followTerrain = switches.has('terrain') ? createTerrainGround(context) : undefined;
	const pickViews = switches.has('impostors') ? await createImpostorField(context) : undefined;
	// The camera's position for the add-ons' steps, and the target that the path writes beside it.
	const cameraAt = new Float64Array(3);
	const lookAt = new Float64Array(3);
	const morph = createMorphedRow(context, readMorphed(import.meta.url));
	createLabels(context, Number(switches.get('labels') ?? 0));
	const grading = switches.has('grading');
	const outlined = switches.has('outline');
	if (outlined) createOutlined(context);
	const moveCasters = switches.has('tileShadows') ? createTileShadows(context) : undefined;
	const reflection = switches.get('reflection');
	if (reflection !== null) createWater(context, reflection);
	if (switches.has('transmission')) createClearWater(context);
	const ssr = switches.get('ssr');
	if (ssr !== null) createPolishedFloor(context, ssr);
	const weighted = switches.get('weighted');
	const moveSmoke =
		weighted === null ? undefined : await createSmoke(context, weighted === 'sorted');
	const decals = switches.get('decals');
	const turnDecals = decals === null ? undefined : createDecals(context, decals !== 'off');
	const particles = switches.has('particles') ? await createParticleFountains(context) : [];
	const soft = switches.has('passes') ? createSoftGlow(context) : undefined;
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
	const eye = { autoExposure: { compensation: 0 } };
	const exposure = switches.has('exposure');
	if (switches.has('fog'))
		context.scene.setFog({
			color: '#8090a0',
			density: 0.01,
			heightFalloff: 0.05,
			volumetric: true,
		});
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
	// The glow's strength in each color, changed in place: a fraction passed on its own to a call
	// that the browser does not inline becomes a number object of its own each frame.
	const softness: [number, number, number] = [0.3, 0.3, 0.3];
	// The environment's options, changed in place, as the grading's settings are.
	const turn: [number, number, number] = [0, 0, 0];
	const lighting = { intensity: 1, rotation: turn };
	let room: Environment | undefined;
	// The sky's settings, changed in place: its sun rises and sets, and its clouds drift.
	// `sky=clear` draws it without clouds, and `sky=still` keeps its sun and clouds where they are.
	// `sky=light` lights the swarm with the sky's environment too, which refreshes in stages as
	// the sun moves, for the allocation sample of the sky map's stages and its diffuse light.
	// `sky=physical` draws the physical sky in place of three.js's, which draws its sky view table
	// again in every frame while the sun moves, and `sky=physical-light` lights the swarm with its
	// environment too.
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
	const physical = skyMode === 'physical' || skyMode === 'physical-light';
	const skyBackground = physical ? { atmosphere: skySettings } : { sky: skySettings };
	if (sky) context.scene.setBackground(skyBackground);
	if (skyMode === 'room')
		void context.assets.builtinEnvironment('room').then((loaded) => {
			context.scene.setBackground(loaded);
		});
	if (skyMode === 'light' || skyMode === 'physical-light')
		void context.assets.skyEnvironment().then((loaded) => {
			context.scene.setEnvironment(loaded);
		});
	if (switches.has('environment'))
		void context.assets.builtinEnvironment('room').then((loaded) => {
			room = loaded;
		});
	const now = new Float64Array(1);
	const poseHemispheres = switches.has('hemisphere') ? createHemispheres(context, now) : undefined;
	const areas = switches.has('areaLights') ? createAreaLights(context) : undefined;
	const setValues = switches.has('setters') ? await createSetters(context, camera, now) : undefined;
	const pose = (t: number) => {
		poseSwarm(t);
		moveCamera(t);
		animate(t);
		morph(t);
		moveCasters?.(t);
		moveSmoke?.(t);
		turnDecals?.(t);
		if (followTerrain || pickViews) {
			s1Camera(t, cameraAt, lookAt);
			followTerrain?.(cameraAt);
			pickViews?.(cameraAt);
		}
		if (outlined) {
			line.width = 2 + Math.sin(t);
			context.post.set(outlineSettings);
		}
		// The frame's time goes through a typed array: a step of its own takes no fraction, so no
		// number crosses a call that the browser may not inline.
		now[0] = t;
		if (areas)
			for (let k = 0; k < areas.length; k++) {
				const angle = t * 0.3 + (k * Math.PI * 2) / areas.length;
				const light = areas[k] as (typeof areas)[number];
				light.setPosition(Math.cos(angle) * S1_EXTENT, 4, Math.sin(angle) * S1_EXTENT);
				light.setDirection(-Math.cos(angle), -0.3, -Math.sin(angle));
				light.setIntensity(4 + Math.sin(t + k));
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
		if (exposure) {
			eye.autoExposure.compensation = 0.5 * Math.sin(t);
			context.post.set(eye);
		}

		if (tint && haze) {
			warm[2] = 0.9 + 0.1 * Math.sin(t);
			context.post.setEffectUniform(tint, 'color', warm);
			mist[0] = 0.43 + 0.05 * Math.cos(t);
			context.post.setEffectUniform(haze, 'color', mist);
		}
		if (soft) {
			softness[0] = 0.3 + 0.1 * Math.sin(t);
			context.render.setPassUniform(soft, 'glow', softness);
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
		// The setters' steps run in their own small callback, apart from the large `pose`: the
		// browser then inlines each step and the setters it calls, so a fraction that a step computes
		// stays in a register instead of becoming an object.
		onLateUpdate() {
			poseHemispheres?.();
			setValues?.();
			for (let k = 0; k < particles.length; k++) particles[k]?.update();
		},
	};
});

/**
 * Two particle systems for the `particles` switch, which write births every frame: soft dots that
 * bounce off the ground, and glows from a texture made in code that fade near the boxes behind
 * them, so the frame copies the opaque depth.
 */
async function createParticleFountains(context: SketchContext): Promise<ParticleSystem[]> {
	const fountain = await createParticles(context, {
		rate: 4000,
		lifetime: [1.5, 2.5],
		shape: { type: 'cone', radius: 0.5, angle: 0.4 },
		speed: [6, 9],
		gravity: [0, -9.8, 0],
		groundHeight: 0,
		size: [0.08, 0.12],
		colors: ['#9cc8ff', '#ffffff'],
		alphaOverLife: [1, 1, 0],
	});
	const glows = await createParticles(context, {
		...particleTextures.glow(context.textures),
		position: [0, S1_BOB_HEIGHT, 0],
		rate: 1500,
		lifetime: 3,
		shape: { type: 'box', size: [2 * S1_EXTENT, 2, 2 * S1_EXTENT] },
		speed: 0.2,
		turbulence: 1,
		size: [0.3, 0.5],
		colors: '#ffb060',
		intensity: 2,
		alphaOverLife: [0, 1, 0],
		softness: 1,
	});
	return [fountain, glows];
}

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
 * A full-screen pass that reads the scene's color at half the render size and softens it, with
 * the glow's strength in each color as a uniform, and a custom effect that adds its texture to the
 * scene.
 */
function createSoftGlow({ render, post, textures }: SketchContext) {
	const pass = render.addPass({
		kind: 'fullscreen',
		wgsl: SOFTEN,
		writes: 'soft',
		scale: 0.5,
		input: 'sceneColor',
		uniforms: { glow: [0.3, 0.3, 0.3] },
	});
	post.addEffect({ wgsl: ADD_SOFT, textures: { soft: textures.fromPass(pass) } });
	return pass;
}

/** A full-screen pass that averages its input around each pixel, scaled by `glow`. */
const SOFTEN = /* wgsl */ `
struct Uniforms { glow: vec3f }

fn effect(input: EffectInput) -> vec4f {
    let step = 2.0 / effectInputSize();
    var sum = vec3f(0.0);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            sum += effectColor(input.uv + vec2f(f32(x), f32(y)) * step).rgb;
        }
    }
    return vec4f(sum / 9.0 * uniforms.glow, 1.0);
}
`;

/** A custom effect that adds the soft pass's texture to the scene's color. */
const ADD_SOFT = /* wgsl */ `
var soft: texture_2d<f32>;

fn effect(input: EffectInput) -> vec4f {
    let glow = textureSampleLevel(soft, softSampler, effectPassUv(input.uv), 0.0).rgb;
    return vec4f(input.color.rgb + glow * input.color.a, input.color.a);
}
`;

/**
 * Two hemisphere lights for the `hemisphere` switch: a blue sky over brown ground, upright, and a
 * warm one tilted an eighth of a turn about X.
 */
/**
 * The `hemisphere` switch: two hemisphere lights, one tilted. Returns the frame's step, which
 * changes their intensities. The calls sit in a step of their own, as a game's update function
 * does, so the browser inlines them and no fraction crosses a call as an object of its own.
 */
function createHemispheres({ scene }: SketchContext, now: Float64Array): () => void {
	const tilt = Math.sin(Math.PI / 8);
	const sky = scene.createHemisphereLight({ skyColor: '#9cc8ff', groundColor: '#806040' });
	const warm = scene.createHemisphereLight({
		skyColor: '#ffd9a8',
		groundColor: '#202830',
		rotation: [tilt, 0, 0, Math.cos(Math.PI / 8)],
	});
	return () => {
		const t = now[0] as number;
		sky.setIntensity(0.3 + 0.1 * Math.sin(t));
		warm.setIntensity(0.2 + 0.1 * Math.cos(t));
	};
}

/** A custom material with a color uniform and a number uniform, for the `setters` switch. */
const TINTED = /* wgsl */ `
struct Uniforms { tint: vec3f, strength: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = mix(s.baseColor, material.tint, material.strength);
    return s;
}
`;

/**
 * The `setters` switch: a point light, a spot light, a hemisphere light, a line batch, a standard
 * material and a custom one. Returns the frame's step, which calls the per-frame setters of the
 * lights, the camera's field of view, the line's width and dashes, the fog and the background color
 * with fractions and colors. The colors are an array changed in place, a hex number and a hex
 * string. The calls sit in a small step of their own, as in a game's update function, so the
 * browser inlines them and no number crosses a call as an object of its own. A material's `set`
 * reads each number from the options object it is given, and the browser boxes such a read, so the
 * two materials are set once, before the frame.
 */
async function createSetters(
	{ scene, materials }: SketchContext,
	camera: PerspectiveCamera,
	now: Float64Array,
): Promise<() => void> {
	const point = scene.createPointLight({ position: [0, 6, 0], intensity: 0.01, range: 10 });
	const spot = scene.createSpotLight({ position: [0, 9, 0], intensity: 0.01, range: 12 });
	const hemisphere = scene.createHemisphereLight({ skyColor: '#9cc8ff', intensity: 0.01 });
	const lines = await scene.createLines({
		positions: new Float32Array([0, 1, 0, 0, 2, 0]),
		mode: 'segments',
		width: 2,
		dashed: true,
	});
	const paint = materials.standard({ color: '#808080' });
	const custom = materials.shader({ wgsl: TINTED, uniforms: { tint: [1, 1, 1], strength: 0.5 } });
	const fov = camera.fov;
	// Every options object and color is made once and changed in place.
	const color: [number, number, number] = [1, 1, 1];
	const paintValues = { color, roughness: 0.5, metalness: 0.5, emissiveIntensity: 1 };
	const customValues = { tint: color, strength: 0.5, roughness: 0.5 };
	const lineValues = { color, dashOffset: 0.5 };
	const fog = { color, density: 0.001 };
	// A material's `set` reads each number from the options object it is given, and the browser
	// boxes such a read, so a material is set once here and not in every frame.
	paint.set(paintValues);
	custom.set(customValues);
	return () => {
		const t = now[0] as number;
		const s = Math.sin(t);
		const c = Math.cos(t);
		color[0] = 0.75 + 0.25 * s;
		color[2] = 0.75 + 0.25 * c;
		point.setIntensity(0.01 + 0.005 * s);
		point.setRange(10 + s);
		point.setDecay(2 + 0.5 * c);
		point.setColor(color);
		spot.setIntensity(0.01 + 0.005 * c);
		spot.setAngle(0.5 + 0.1 * s);
		spot.setPenumbra(0.25 + 0.1 * c);
		spot.setColor(s > 0 ? 0xffd9a8 : '#9cc8ff');
		hemisphere.setGroundColor(color);
		camera.setFov(fov + 0.5 * s);
		lines.setWidth(2 + s);
		lineValues.dashOffset = 0.5 + 0.5 * s;
		lines.material.set(lineValues);
		fog.density = 0.001 + 0.0005 * s;
		scene.setFog(fog);
		scene.setBackground(color);
	};
}

/**
 * Eight rectangle lights, two of which show a striped image, and four tube lights for the
 * `areaLights` switch. The frames move them around the swarm.
 */
function createAreaLights({ scene }: SketchContext) {
	const stripes = new Uint8Array(16 * 16 * 4).map((_, i) => ((i >> 6) % 2 ? 255 : 40));
	const image = { width: 16, height: 16, data: stripes };
	const range = S1_EXTENT * 3;
	return Array.from({ length: 12 }, (_, k) =>
		k < 8
			? scene.createRectAreaLight({
					width: 4,
					height: 2,
					range,
					color: k % 2 ? '#ffd29a' : '#9ad2ff',
					dynamic: true,
					...(k < 2 ? { image } : {}),
				})
			: scene.createTubeLight({ length: 3, range, color: '#ff6ab0', dynamic: true }),
	);
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

/** The layers that the `coatSheen` switch asks for, or none without it. */
function readCoatSheen(value: string | null): SwarmCoatSheen | undefined {
	if (value === null) return undefined;
	if (value === '') return 'both';
	if (value === 'coat' || value === 'sheen' || value === 'both') return value;
	throw new Error(`coatSheen=${value} names no layers: take coat, sheen or both`);
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

/** The reflections' grid as a share of the render size, by the `ssr` switch's value. */
const SSR_SCALES = { half: 0.5, quarter: 0.25, off: 0 } as const;

/**
 * Adds the `ssr` switch's polished floor under the swarm, and turns screen-space reflections on,
 * which reflect the swarm in it.
 */
function createPolishedFloor(
	{ scene, geometry, materials, post, quality }: SketchContext,
	size: string,
) {
	const scale = SSR_SCALES[size as keyof typeof SSR_SCALES];
	if (scale !== undefined) quality.set({ ssrScale: scale });
	post.set({ ssr: { maxDistance: 400, thickness: 2 } });
	const floor = scene.createMesh({
		mesh: geometry.plane({ width: 1200, height: 1200 }),
		material: materials.standard({ color: '#1a1d21', roughness: 0.08, metalness: 0.3 }),
		position: [0, WATER_HEIGHT, 0],
	});
	floor.setRotationEuler(-Math.PI / 2, 0, 0);
}
/** The puffs of the `weighted` switch's smoke, and how long each one rises, in seconds. */
const SMOKE_PUFFS = 2000;
const SMOKE_LIFE = 8;

/**
 * Adds the `weighted` switch's column of smoke over the swarm's middle: soft puffs of the weighted
 * blending, or of the normal blending with `sorted`, that rise, swell and fade. Returns the function
 * that moves them to a time, which writes the batch's arrays and allocates nothing.
 */
async function createSmoke({ scene, textures }: SketchContext, sorted: boolean) {
	const size = 32;
	const dot = new Uint8Array(size * size * 4).fill(255);
	for (let i = 0; i < size * size; i++) {
		const r = Math.hypot((i % size) + 0.5 - size / 2, Math.floor(i / size) + 0.5 - size / 2);
		dot[i * 4 + 3] = 255 * Math.max(0, 1 - (2 * r) / size) ** 2;
	}
	const map = textures.fromData({ width: size, height: size, data: dot });
	const puffs = await scene.createSprites({
		count: SMOKE_PUFFS,
		map,
		dynamic: true,
		depthWrite: false,
		blending: sorted ? 'normal' : 'weighted',
	});
	return (t: number) => {
		const { positions, sizes, colors } = puffs;
		for (let i = 0; i < SMOKE_PUFFS; i++) {
			const seed = (i * 0.618034) % 1;
			const age = (t / SMOKE_LIFE + seed) % 1;
			const turn = i * 2.39996 + age * 3;
			const spread = 2 + age * 18;
			positions[i * 3] = Math.cos(turn) * spread * seed;
			positions[i * 3 + 1] = S1_BOB_HEIGHT + age * 60;
			positions[i * 3 + 2] = Math.sin(turn) * spread * seed;
			sizes[i * 2] = sizes[i * 2 + 1] = 4 + age * 14;
			colors[i * 4] = colors[i * 4 + 1] = colors[i * 4 + 2] = 0.55 + 0.3 * seed;
			colors[i * 4 + 3] = 0.35 * Math.min(1, age * 8) * (1 - age);
		}
	};
}

/** Decals on each side of the `decals` switch's square of them, and the texels of their image. */
const DECAL_ROWS = 16;
const DECAL_TEXELS = 64;

/**
 * Adds the `decals` switch's ground under the swarm, and with `marked` a dynamic batch of decals on
 * it: soft round marks with a dark ring, in a square across the swarm's extent. Returns the step
 * that turns each one about the vertical, which writes the batch's rotations in place.
 */
function createDecals({ scene, geometry, materials, textures }: SketchContext, marked: boolean) {
	const ground = scene.createMesh({
		mesh: geometry.plane({ width: 1200, height: 1200 }),
		material: materials.standard({ color: '#6b6560', roughness: 0.9 }),
		position: [0, WATER_HEIGHT, 0],
	});
	ground.setRotationEuler(-Math.PI / 2, 0, 0);
	if (!marked) return undefined;
	const data = new Uint8Array(DECAL_TEXELS * DECAL_TEXELS * 4);
	for (let y = 0; y < DECAL_TEXELS; y++)
		for (let x = 0; x < DECAL_TEXELS; x++) {
			const r =
				Math.hypot(x + 0.5 - DECAL_TEXELS / 2, y + 0.5 - DECAL_TEXELS / 2) / (DECAL_TEXELS / 2);
			const ring = Math.max(0, 1 - Math.abs(r - 0.8) * 8);
			const shade = 40 + 120 * (1 - ring);
			data.set(
				[shade, shade * 0.8, shade * 0.6, 255 * Math.max(0, Math.min(1, (1 - r) * 4))],
				(y * DECAL_TEXELS + x) * 4,
			);
		}
	const map = textures.fromData({
		width: DECAL_TEXELS,
		height: DECAL_TEXELS,
		data,
		colorSpace: 'srgb',
		mipmaps: true,
	});
	const count = DECAL_ROWS * DECAL_ROWS;
	const decals = scene.createInstances(geometry.box(), count, {
		material: materials.decal({ map, roughness: 0.4 }),
		dynamic: true,
	});
	const spacing = (2 * S1_EXTENT) / DECAL_ROWS;
	for (let k = 0; k < count; k++) {
		const [column, row] = [k % DECAL_ROWS, Math.floor(k / DECAL_ROWS)];
		const x = -S1_EXTENT + (column + 0.5) * spacing;
		const z = -S1_EXTENT + (row + 0.5) * spacing;
		decals.positions.set([x, WATER_HEIGHT, z], k * 3);
		decals.scales.set([spacing * 0.9, spacing * 0.9, 30], k * 3);
	}
	const rotations = decals.rotations;
	return (t: number) => {
		for (let k = 0; k < count; k++) {
			// A box turned to project down, then about the vertical by its own angle.
			const half = 0.5 * (t + k);
			const c = Math.SQRT1_2 * Math.cos(half);
			const s = Math.SQRT1_2 * Math.sin(half);
			rotations[k * 4] = -c;
			rotations[k * 4 + 1] = s;
			rotations[k * 4 + 2] = s;
			rotations[k * 4 + 3] = c;
		}
	};
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
