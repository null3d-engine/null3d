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
	// The sky's settings, changed in place: its sun rises and sets, and its clouds drift.
	const sky = switches.has('sky');
	const sun: [number, number, number] = [0, 0.2, -1];
	const skySettings = { sunPosition: sun, time: 0 };
	const skyBackground = { sky: skySettings };
	if (switches.has('environment'))
		void context.assets.builtinEnvironment('room').then((loaded) => {
			room = loaded;
		});
	const pose = (t: number) => {
		poseSwarm(t);
		moveCamera(t);
		animate(t);
		morph(t);
		if (outlined) {
			line.width = 2 + Math.sin(t);
			context.post.set(outlineSettings);
		}
		if (room) {
			turn[1] = 0.5 * t;
			lighting.intensity = 0.75 + 0.25 * Math.sin(t);
			context.scene.setEnvironment(room, lighting);
		}
		if (sky) {
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
