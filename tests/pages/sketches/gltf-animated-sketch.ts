// Animated glTF sample characters at a held time: the KayKit Knight walking, with a sword in its
// hand and a shield on its arm that follow its joints, and the Fox running. The skinning passes
// draw their poses. ?still holds each in its clip's first pose, and ?mark posts 'instantiate' to
// the page right before the sketch adds the models.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** How fast the clips play: not at all with ?still. */
const SPEED = params.has('still') ? 0 : 1;

/** The address of a sample file on the dev server, as `sampleUrl` in tools/lib/samples.ts gives it. */
const sampleUrl = (path: string) => `/samples/${path}`;

/** The Knight's accessories that the walk shows: one sword and one shield. */
const KEPT = new Set(['1H_Sword', 'Round_Shield']);
const ACCESSORIES = [
	'1H_Sword',
	'1H_Sword_Offhand',
	'2H_Sword',
	'Badge_Shield',
	'Rectangle_Shield',
	'Round_Shield',
	'Spike_Shield',
];

export default defineSketch(async ({ scene, assets, post, page }) => {
	post.set({ toneMapping: 'none' });
	scene.setBackground('#60666e');
	scene.createDirectionalLight({ direction: [-1, -2, -1.5], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.5 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 40, position: [0, 1.4, 5.5], target: [0, 0.9, 0] }),
	);
	const [knight, fox] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/characters/kaykit-knight/Knight.glb')),
		assets.loadGltf(sampleUrl('sources/khronos/Fox/glTF-Binary/Fox.glb')),
	]);
	if (params.has('mark')) page.post('instantiate', null);
	const walker = scene.instantiate(knight, {
		position: [-0.9, 0, 0],
		rotation: [0, 0.38, 0, 0.92],
	});
	for (const name of ACCESSORIES) if (!KEPT.has(name)) walker.find(name)?.setVisible(false);
	walker.animator().play('Walking_A', { speed: SPEED });
	const size = 1.6 / (2 * fox.bounds.radius);
	const runner = scene.instantiate(fox, {
		position: [1.1, 0, 0],
		rotation: [0, -0.38, 0, 0.92],
		scale: [size, size, size],
	});
	runner.animator().play('Run', { speed: SPEED });
	return {};
});
