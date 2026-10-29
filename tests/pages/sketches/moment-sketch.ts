// The moment transparency test's scene: five panes of glass at different depths that overlap on
// the screen and never cross each other. The engine sorts them, so `?mode=sorted` gives the exact
// back-to-front image; `?mode=weighted` blends them by the weighted blending, and `?mode=moment`
// draws them in the moment layer, which the page's `?moments=on` switch turns on. The test compares
// both approximations with the sorted image. `?order=reverse` adds the panes in the opposite
// order, so a test can hold the layer to the same picture whatever order the draws take.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const mode = params.get('mode') ?? 'sorted';
const blending = mode === 'weighted' ? 'weighted' : 'normal';

/** The panes, from the nearest to the farthest: its color, its place, and its size. */
const PANES = [
	['#e03020', [0.45, 1.35, 2.4], [2.2, 1.5]],
	['#20c060', [-0.35, 1.0, 1.2], [2.4, 1.7]],
	['#2050f0', [0.3, 0.9, 0.0], [2.6, 1.8]],
	['#f0c020', [-0.25, 1.2, -1.2], [2.4, 1.7]],
	['#c030c0', [0.2, 1.05, -2.4], [2.2, 1.5]],
] as const;

// `?spread=1` places the five panes across the model's range of one to thirty metres from the
// camera, each sized to keep its place on screen, with the wall far behind them. The default
// scene keeps them within a few metres, the hard case for a two-atom fit.
const spread = params.get('spread') === '1';
const cameraAt: readonly [number, number, number] = [0, 1.2, 6.5];
const depths = [1, 8, 15, 22, 29] as const;
/** A pane: its color, its place, and its size. */
type Pane = readonly [string, readonly [number, number, number], readonly [number, number]];

/** The panes in the order that the sketch adds them: near to far, or the reverse. */
const panes: readonly Pane[] = (() => {
	const list = spread
		? PANES.map(([color], i) => {
				const d = depths[i] as number;
				const position = [((i % 2) * 2 - 1) * 0.15 * d, 1.1, cameraAt[2] - d] as const;
				const size = [0.6 + 0.55 * d, 0.45 + 0.4 * d] as const;
				return [color, position, size] as const;
			})
		: PANES;
	return params.get('order') === 'reverse' ? [...list].reverse() : list;
})();

export default defineSketch(({ scene, materials, geometry }) => {
	// The page starts the engine without anti-aliasing, so MSAA does not smooth the panes
	// differently on the three images, and with `moments=on` for the moment layer's modes.
	scene.setBackground('#20242c');
	scene.createDirectionalLight({ direction: [-0.6, -2, -1.4], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.8 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 45, position: cameraAt, target: [0, 1.1, 0] }),
	);
	// An opaque wall behind the panes, so what shows through them has a colour of its own.
	scene.createMesh({
		mesh: geometry.plane({ width: spread ? 120 : 14, height: spread ? 120 : 6 }),
		material: materials.standard({ color: '#6b7480', roughness: 0.9 }),
		position: [0, 1.1, spread ? -40 : -6],
	});
	// The panes: drawn in their list's order, which the sorted pass then orders back to front.
	for (const [color, position, [width, height]] of panes) {
		scene.createMesh({
			mesh: geometry.plane({ width, height }),
			material: materials.standard({
				color,
				opacity: 0.45,
				roughness: 0.35,
				alphaMode: 'blend',
				blending,
				depthWrite: false,
			}),
			position,
		});
	}
});
