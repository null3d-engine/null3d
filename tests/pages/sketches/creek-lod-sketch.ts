// The Creek's oak at the bias where its leaves change level, for the test of a switch that must
// fade. The camera holds still and the page moves the level bias instead, so every change between
// two frames is the hand-over alone. The file's own levels carry the errors that the Blender script
// sets by hand; `?lod=0` draws the base mesh at every bias.
import { defineSketch } from '@null3d/engine';
import { AMBIENT, SUN } from '../../../bench/scenes/spec';

const params = new URL(import.meta.url).searchParams;
/** The point that the camera looks at, in meters from the tree's own origin. */
const AIM: [number, number, number] = [3, 4, 0];
/** The camera's distance from that point, in meters. */
const REACH = 14;
/** The vertical field of view in degrees. */
const FOV = 45;
/** The tree part whose crown the test frames. */
const PART = 'oak-leaves';

export default defineSketch(async ({ scene, assets, quality, page, engine }) => {
	// A fixed render scale and no governor, so the level lies at the same bias on every run.
	const given = params.get('lod');
	const threshold = given === null ? 1 : Number(given);
	if (!(threshold >= 0 && threshold <= 16))
		throw new Error(`the page asked for a threshold of ${given} in ${params.toString()}`);
	quality.set({
		lodThreshold: threshold,
		minRenderScale: 1,
		maxRenderScale: 1,
		governor: false,
	});
	scene.setBackground('#8fb4d8');
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);
	const trees = await assets.loadGltf('/samples/sources/showcase/creek/trees.glb');
	const node = trees.find(PART);
	if (!node?.mesh || !node.material) throw new Error(`the file has no part named ${PART}`);
	const tree = scene.createMesh({
		mesh: node.mesh,
		material: node.material,
		scale: node.scale,
		castShadows: true,
		receiveShadows: true,
	});
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: FOV,
			near: 0.1,
			far: 500,
			position: [AIM[0], AIM[1], AIM[2] + REACH],
			target: AIM,
		}),
	);
	// The switch distance of each level at a bias of 1, which the page prints as evidence.
	const tan = Math.tan((FOV * Math.PI) / 360);
	const factor =
		(engine.viewport.height * engine.viewport.pixelRatio) /
		(2 * tan * quality.settings.lodThreshold);
	const levels = node.mesh.levels;
	const errors = levels.map((level) => level.error ?? 0);
	page.post('levels', {
		errors,
		fades: levels.map((level) => level.fade),
		switches: errors.map((error) => error * node.scale[0] * factor),
	});
	// The bias that the page asked for, and the one that the sketch applied, so the page waits for
	// the sketch to take it before it captures.
	let placed = Number.NaN;
	let drawn = Number.NaN;
	page.onMessage((name, value) => {
		if (name !== 'bias') return;
		tree.setLevelBias(Number(value));
		placed = Number(value);
	});
	return {
		onUpdate() {
			if (placed === drawn) return;
			drawn = placed;
			page.post('drawn', drawn);
		},
	};
});
