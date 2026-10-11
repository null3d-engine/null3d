// The scene's object tables grow during play, for the object growth test. Both modes draw the same
// boxes, a tree and a turned dynamic box, and post 'before' once frames have drawn. On the page's
// 'grow', ?mode=grow creates groups, which draw nothing, in each of several frames: each frame's
// creates fill the tables, so the scene grows in every one of those frames, at a create call or
// at the frame's start. The first of them also destroys a group with a child, and moves a box
// again to where it already went. In the first frame both modes move that box, turn the dynamic
// box, and add a box under the tree's root, whose slot in grow mode lies past every slot of the
// tables it started with. Both modes post 'after' once frames have drawn. ?play-ms= sets the least
// time of play before 'before'. Each message carries the render scale that the frame drew at.
import { defineSketch, type Group } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const growing = params.get('mode') === 'grow';
/** The least time of play before the picture before, in ms. */
const PLAY_MS = Number(params.get('play-ms') ?? 0);
/** Groups that each frame of the growth creates. */
const GROUPS = [1_500, 3_000, 6_000, 12_000, 24_000];
/** Frames before each picture. */
const FRAMES = 6;

export default defineSketch(({ scene, geometry, materials, page, quality, time }) => {
	// The test slows every frame far below the target rate, so the frame-budget governor would
	// lower the render scale once its grace after the first frame ends. When it does depends on how
	// fast the machine runs, so the two engines could draw at different scales. Off, both draw at
	// the highest scale.
	quality.set({ governor: false });
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({ position: [0, 4, 12], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });
	const paint = materials.standard({ color: '#c8a060', roughness: 0.6 });
	const blue = materials.standard({ color: '#4a8cff', roughness: 0.4 });
	const box = geometry.box();
	const boxes = [];
	for (let x = -3; x <= 3; x++)
		for (let z = -2; z <= 0; z++)
			boxes.push(
				scene.createMesh({ mesh: box, material: paint, position: [x * 1.5, -1, z * 1.5] }),
			);
	const root = scene.createGroup({ position: [0, 1, 0] });
	scene.createMesh({ mesh: geometry.sphere(), material: blue, parent: root, position: [-2, 0, 0] });
	const spinner = scene.createMesh({
		mesh: box,
		material: blue,
		position: [3, 1.5, 0],
		rotation: [0, 0.3826834, 0, 0.9238795],
		dynamic: true,
	});
	const moved = boxes[3];
	if (!moved) throw new Error('the sketch made no boxes');

	let start = -1;
	let startMs = 0;
	let ready = false;
	let asked = false;
	let grown = -1;
	const hidden: Group[] = [];
	page.onMessage((message) => {
		if (message === 'grow') asked = true;
	});
	return {
		onUpdate() {
			if (start < 0) {
				start = time.frame;
				startMs = performance.now();
			}
			if (!ready && time.frame - start >= FRAMES && performance.now() - startMs >= PLAY_MS) {
				ready = true;
				page.post('before', { renderScale: quality.renderScale });
			}
			if (grown < 0 && asked) grown = time.frame;
			if (grown < 0) return;
			const step = time.frame - grown;
			const count = growing ? (GROUPS[step] ?? 0) : 0;
			for (let k = 0; k < count; k++)
				hidden.push(scene.createGroup({ position: [0, -50, 0], parent: hidden[k * 2] }));
			if (step === 0) {
				moved.setPosition(0, 3, 0);
				spinner.setRotation(0, 0, 0, 1);
				scene.createMesh({ mesh: box, material: paint, parent: root, position: [2, 1, 0] });
			}
			if (growing && step === 1) {
				hidden[1]?.destroy();
				moved.setPosition(0, 3, 0);
			}
			if (step === GROUPS.length + FRAMES)
				page.post('after', {
					objects: growing ? hidden.length + 1 : 1,
					renderScale: quality.renderScale,
				});
		},
	};
});
