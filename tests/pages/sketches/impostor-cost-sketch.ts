// The field of impostor cards for the page that measures their frame cost: cards on a plane fill
// the view, so every pixel that a card covers runs the card material's three-view blend and its
// normal decodes. The page's messages hide the whole batch and show it again, so the two sides
// differ by the card batch alone. The governor stays off, so the render scale holds.
import { defineSketch } from '@null3d/engine';
import { bakeImpostorAtlas, createImpostors, octahedralAtlas } from '@null3d/impostors';

/** The cards across and down the view, and the size of each card in world units. */
const COLUMNS = 19;
const ROWS = 8;
const WIDTH = 2.4;
const HEIGHT = 3.6;

export default defineSketch(({ scene, materials, geometry, textures, quality, page }) => {
	quality.set({ governor: false });
	scene.setBackground('#4a6a8a');
	scene.setActiveCamera(
		scene.createOrthographicCamera({
			height: 20,
			near: 0.1,
			far: 40,
			position: [0, 0, 20],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({
		direction: [-0.4, -0.6, -0.7],
		color: '#fff4e0',
		intensity: 3,
	});
	scene.createAmbientLight({ color: '#9fb4d8', intensity: 0.6 });

	// A plain square baked into both atlases, so every card draws the same surface with the same
	// texture reads that a real bake's card makes.
	const bake = bakeImpostorAtlas({
		atlas: octahedralAtlas(4),
		texels: 8,
		parts: [
			{
				positions: [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0],
				colors: [0.4, 0.6, 0.35, 0.4, 0.6, 0.35, 0.4, 0.6, 0.35, 0.4, 0.6, 0.35],
				indices: [0, 1, 2, 0, 2, 3],
				doubleSided: true,
			},
		],
		min: [-0.5, 0, 0],
		max: [0.5, 1, 0],
	});
	const color = textures.fromData({
		width: bake.color.width,
		height: bake.color.height,
		data: bake.color.data,
		colorSpace: 'srgb',
		wrap: 'clamp',
		mipmaps: false,
	});
	const surface = textures.fromData({
		width: bake.surface.width,
		height: bake.surface.height,
		data: bake.surface.data,
		colorSpace: 'linear',
		wrap: 'clamp',
		mipmaps: false,
	});

	const positions: number[] = [];
	for (let row = 0; row < ROWS; row++)
		for (let column = 0; column < COLUMNS; column++)
			positions.push((column - (COLUMNS - 1) / 2) * 2, (row - 1.5) * 3 - 9, 0);
	const cards = createImpostors(
		{ scene, materials, geometry },
		{
			color,
			surface,
			atlas: bake.atlas,
			positions,
			size: [WIDTH, HEIGHT],
			alphaMode: 'mask',
		},
	);
	const count = cards.count;

	page.onMessage((message) => {
		if (message !== 'cards' && message !== 'cards-off') return;
		cards.batch.setActiveCount(message === 'cards' ? count : 0);
		void scene.warmUp().then(() => page.post('settled', { cards: count }));
	});
});
