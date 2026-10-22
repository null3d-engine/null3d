// A screen on the gallery wall, beside the plinth: a plan drawn into a texture from code, with a
// square for each click. The hit carries the plane's own texture coordinates, so the square lands
// where the pointer points without the sketch working out where the plane lies in space. The
// texture changes only when a click adds a mark, so a held frame draws the same plan on every run.
import type { SketchContext } from '@null3d/engine';

/** The texture's size, at the 2:1 shape of the screen. */
const WIDTH = 128;
const HEIGHT = 64;
/** The screen's size in meters. */
const W = 3.2;
const H = 1.6;
/** How many click marks the plan keeps. */
const KEPT = 8;

/** The plan's colors, as sRGB bytes. */
const BACK = [34, 46, 78] as const;
const GRID = [86, 132, 180] as const;
const MARK = [255, 214, 120] as const;

export function createScreen(ctx: SketchContext) {
	const { scene, geometry, materials, textures } = ctx;
	const data = new Uint8Array(WIDTH * HEIGHT * 4);
	const marks: [number, number][] = [];
	const put = (x: number, y: number, rgb: readonly [number, number, number]) => {
		if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
		const at = (y * WIDTH + x) * 4;
		data[at] = rgb[0];
		data[at + 1] = rgb[1];
		data[at + 2] = rgb[2];
		data[at + 3] = 255;
	};
	// The plan: a lit ground under a grid, and a square at each click.
	const draw = () => {
		for (let y = 0; y < HEIGHT; y++)
			for (let x = 0; x < WIDTH; x++) put(x, y, x % 16 === 0 || y % 16 === 0 ? GRID : BACK);
		for (const [u, v] of marks)
			for (let dy = -2; dy <= 2; dy++)
				for (let dx = -2; dx <= 2; dx++)
					put(Math.round(u * WIDTH) + dx, Math.round(v * HEIGHT) + dy, MARK);
	};
	draw();
	const map = textures.fromData({ width: WIDTH, height: HEIGHT, data, colorSpace: 'srgb' });
	const screen = scene.createMesh({
		mesh: geometry.plane({ width: W, height: H }),
		material: materials.unlit({ map }),
		position: [0, 1.1, -4.2],
	});
	scene.createMesh({
		mesh: geometry.box({ width: W + 0.16, height: H + 0.16, depth: 0.1 }),
		material: materials.standard({ color: '#0e1014', roughness: 0.5 }),
		position: [0, 1.1, -4.27],
	});
	screen.on('click', (event) => {
		// A plane has texture coordinates; a hit that found none has nothing to mark.
		if (!event.hasUv) return;
		marks.push([event.uv[0], event.uv[1]]);
		if (marks.length > KEPT) marks.shift();
		draw();
		map.update(data);
	});
}
