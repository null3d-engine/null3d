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
// light.
import { defineSketch, type Environment, type SketchContext } from '@null3d/engine';
import { GRADING_LUTS } from '../../scenes/grading';
import { s1Camera } from '../../scenes/spec';
import { createAnimatedCrowd, readAnimated } from './crowd';
import { createMorphedRow, readMorphed } from './morphed';
import { followPath, readCount, setUpView } from './sketch-common';
import { createLineSwarm, createSpriteSwarm, createSwarm } from './swarm';

export default defineSketch(async (context) => {
	const { time } = context;
	const moveCamera = followPath(setUpView(context), s1Camera);
	const switches = new URL(import.meta.url).searchParams;
	const count = readCount(import.meta.url);
	const poseSwarm = switches.has('sprites')
		? await createSpriteSwarm(context, count)
		: switches.has('lines')
			? await createLineSwarm(context, count)
			: createSwarm(context, count, true, undefined, switches.has('blend')).pose;
	const animate = createAnimatedCrowd(context, readAnimated(import.meta.url));
	const morph = createMorphedRow(context, readMorphed(import.meta.url));
	createLabels(context, Number(switches.get('labels') ?? 0));
	const grading = switches.has('grading');
	const outlined = switches.has('outline');
	if (outlined) createOutlined(context);
	const moveCasters = switches.has('tileShadows') ? createTileShadows(context) : undefined;
	// One settings object, changed in place, so the sketch's own code allocates nothing per frame.
	const vignette = { offset: 1, darkness: 1 };
	const settings = { lutIntensity: 1, vignette };
	const line = { width: 2 };
	const outlineSettings = { outline: line };
	if (grading)
		void context.assets.loadLut(GRADING_LUTS.warm).then((lut) => context.post.set({ lut }));
	const ao = switches.has('ao');
	const occlusion = { ao: { intensity: 1 } };
	if (ao) context.quality.set({ aoScale: 0.5 });
	const bloom = switches.has('bloom');
	const glow = { bloom: { intensity: 0.15 } };
	// The environment's options, changed in place, as the grading's settings are.
	const turn: [number, number, number] = [0, 0, 0];
	const lighting = { intensity: 1, rotation: turn };
	let room: Environment | undefined;
	if (switches.has('environment'))
		void context.assets.builtinEnvironment('room').then((loaded) => {
			room = loaded;
		});
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
		if (room) {
			turn[1] = 0.5 * t;
			lighting.intensity = 0.75 + 0.25 * Math.sin(t);
			context.scene.setEnvironment(room, lighting);
		}
		if (ao) {
			occlusion.ao.intensity = 0.75 + 0.25 * Math.sin(t);
			context.post.set(occlusion);
		}
		if (bloom) {
			glow.bloom.intensity = 0.15 + 0.05 * Math.sin(t);
			context.post.set(glow);
		}
		if (!grading) return;
		settings.lutIntensity = 0.5 + 0.5 * Math.sin(t);
		vignette.offset = 1 + 0.25 * Math.cos(t);
		context.post.set(settings);
	};
	pose(time.now);
	return {
		onUpdate() {
			pose(time.now);
		},
	};
});

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
