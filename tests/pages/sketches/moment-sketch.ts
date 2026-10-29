// The moment transparency test's scene: five panes of glass at different depths that overlap on
// the screen and never cross each other. The engine sorts them, so `?mode=sorted` gives the exact
// back-to-front image; `?mode=weighted` blends them by the weighted blending, and `?mode=moment`
// turns the quality setting `momentTransparency` on and blends them by the moment layer. The test
// compares both approximations with the sorted image.
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

export default defineSketch(({ scene, materials, geometry, quality }) => {
	// The pane edges are what SMAA smooths, and MSAA would smooth them differently on the three
	// images, so every mode draws without anti-aliasing.
	quality.set({ antialias: 'none', momentTransparency: mode === 'moment' });
	scene.setBackground('#20242c');
	scene.createDirectionalLight({ direction: [-0.6, -2, -1.4], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.8 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 45, position: [0, 1.2, 6.5], target: [0, 1.1, 0] }),
	);
	// An opaque wall behind the panes, so what shows through them has a colour of its own.
	scene.createMesh({
		mesh: geometry.plane({ width: 14, height: 6 }),
		material: materials.standard({ color: '#6b7480', roughness: 0.9 }),
		position: [0, 1.1, -6],
	});
	// The panes: drawn in their list's order, which the sorted pass then orders back to front.
	for (const [color, position, [width, height]] of PANES) {
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
