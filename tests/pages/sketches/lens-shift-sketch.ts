// A lit yard of colored blocks under a sun that casts shadows, seen by a wide camera and by a
// narrow one whose lens shift frames one rectangle of the wide camera's image. ?lens=orthographic
// makes both cameras orthographic. The page picks the camera that the canvas shows, or adds a view
// of the narrow camera over its rectangle of the canvas. The sketch posts `drawn` once the change
// has drawn for a few frames.
import { defineSketch } from '@null3d/engine';
import { LENS_SHIFT_FOV, LENS_SHIFT_HEIGHT, LENS_SHIFT_RECT, narrowLens } from '../lib/lens-shift';

const ORTHOGRAPHIC = new URL(import.meta.url).searchParams.get('lens') === 'orthographic';
/** The frames that a change draws before the page reads it. */
const SETTLE = 4;

export default defineSketch(({ scene, geometry, materials, quality, page }) => {
	quality.set({ governor: false });
	scene.setBackground('#9fb7d0');
	const sun = scene.createDirectionalLight({ color: '#fff4e0', intensity: 3, castShadows: true });
	sun.setPosition(6, 10, 4);
	sun.lookAt(0, 0, 0);
	scene.createAmbientLight({ color: '#bcd0ff', intensity: 0.4 });
	const box = geometry.box();
	const ground = materials.standard({ color: '#7a8a5a', roughness: 0.9 });
	scene.createMesh({ mesh: box, material: ground, scale: [60, 0.2, 60], position: [0, -0.1, 0] });
	// Rows of blocks that reach far back, so shadows fall across the whole view.
	const colors = ['#c0392b', '#2980b9', '#f1c40f', '#8e44ad', '#16a085', '#e67e22'];
	for (let row = 0; row < 6; row++)
		for (let column = 0; column < 6; column++) {
			const height = 0.6 + ((row * 7 + column * 3) % 5) * 0.35;
			scene.createMesh({
				mesh: box,
				material: materials.standard({ color: colors[(row + column) % 6] as string }),
				position: [(column - 2.5) * 2.2, height / 2, -row * 3.2 + 2],
				scale: [0.9, height, 0.9],
				castShadows: true,
				receiveShadows: true,
			});
		}
	const pose = { near: 0.5, far: 80, position: [2, 6, 12], target: [0, 0.5, -4] } as const;
	const make = (narrow: boolean) => {
		const lens = narrow ? narrowLens(LENS_SHIFT_RECT) : { scale: 1, shift: [0, 0] as const };
		const camera = ORTHOGRAPHIC
			? scene.createOrthographicCamera({ ...pose, height: LENS_SHIFT_HEIGHT * lens.scale })
			: scene.createPerspectiveCamera({ ...pose, fov: narrowFov(lens.scale) });
		camera.setLensShift(lens.shift[0], lens.shift[1]);
		return camera;
	};
	const wide = make(false);
	const narrow = make(true);
	scene.setActiveCamera(wide);

	let view: ReturnType<typeof scene.createView> | undefined;
	let settle = -1;
	page.onMessage((name, value) => {
		if (name === 'camera') scene.setActiveCamera(value === 'narrow' ? narrow : wide);
		if (name === 'view') {
			view?.destroy();
			view = value ? scene.createView({ camera: narrow, rect: [...LENS_SHIFT_RECT] }) : undefined;
		}
		settle = SETTLE;
	});
	return {
		onUpdate() {
			if (settle < 0) return;
			if (settle-- === 0) page.post('drawn', true);
		},
	};
});

/** The field of view of a lens whose view is `scale` of the wide lens's height. */
function narrowFov(scale: number): number {
	const half = Math.tan((LENS_SHIFT_FOV * Math.PI) / 360) * scale;
	return (360 / Math.PI) * Math.atan(half);
}
