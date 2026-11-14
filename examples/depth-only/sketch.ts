// Glass panes float in front of an embedded page, and a depth-only surface holds the hall behind
// the page back. The canvas is see-through, so the page is a DOM plane below it. A plane with
// `colorWrite: false` at the page's own plane writes depth and no color: the pylons behind never
// draw over the page, while the glass in front still shows the page through it. An opaque plane
// there would hide the page, and the glass with it.
import { defineSketch, quat, type Vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The page's size in CSS pixels, which are the scene's units, and its centre's height. */
const PAGE: [number, number] = [440, 280];
const PAGE_Y = 30;
/** The glass panes: their size, and each one's x, y, z and turn ahead of the page. */
const PANE: [number, number] = [230, 150];
const PANES: readonly [number, number, number, number][] = [
	[-230, 10, 380, -0.42],
	[235, 55, 330, 0.38],
	[10, -110, 520, 0.12],
];
/** The pylons behind the page: their number, the ellipse they stand on and their size. */
const PYLONS = 11;
const PYLON: Vec3 = [64, 720, 64];
const PYLON_X = 1750;
const PYLON_Z = 900;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, time, ui, page } = ctx;
	// No background: the canvas is see-through, and the page behind it shows where nothing draws.
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.9 });
	scene.createDirectionalLight({ direction: [-0.4, -0.7, -0.6], color: '#dceaff', intensity: 1.5 });
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		near: 5,
		far: 6000,
		position: [0, PAGE_Y + 20, 1150],
		target: [0, PAGE_Y, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, {
		target: [0, PAGE_Y, 0],
		// The page faces the camera, so the view stays in front of its plane.
		minAzimuthAngle: -0.45,
		maxAzimuthAngle: 0.45,
		maxPolarAngle: Math.PI * 0.56,
	});

	// The page is the label's element below the canvas, and this plane is exactly its rectangle.
	// With `colorWrite: false` it writes the rectangle's depth and no color, so the pylons behind
	// never reach the page.
	const plane = geometry.plane({ width: PAGE[0], height: PAGE[1] });
	const pagePlane = scene.createMesh({
		mesh: plane,
		material: materials.unlit({ colorWrite: false }),
		position: [0, PAGE_Y, 0],
	});
	ui.trackLabel(pagePlane, 'page', { transform: 'world' });
	page.post('label', {
		id: 'page',
		kind: 'page',
		text: 'DEPTH ONLY',
		detail: 'A page held in the scene. The hall behind it never draws over it.',
		width: PAGE[0],
		height: PAGE[1],
	});

	// A ring of glowing pylons behind the page. The page hides the ones in the middle, and the
	// ones beyond its edges stand around it.
	const pylon = geometry.box({ width: PYLON[0], height: PYLON[1], depth: PYLON[2] });
	const pylonMats = ['#5fb0ff', '#ffb45f'].map((emissive) =>
		materials.standard({
			color: '#0a1018',
			emissive,
			emissiveIntensity: 2.6,
			roughness: 0.35,
			metalness: 0.7,
		}),
	);
	for (let i = 0; i < PYLONS; i++) {
		const angle = (i / PYLONS) * Math.PI * 2;
		scene.createMesh({
			mesh: pylon,
			material: pylonMats[i % pylonMats.length],
			position: [
				Math.sin(angle) * PYLON_X,
				PAGE_Y - 250 + Math.cos(angle * 2) * 90,
				-PYLON_Z + Math.cos(angle) * 700,
			],
		});
	}

	// Three glass panes in front of the page, with a bright rail on each edge.
	const glass = materials.standard({
		color: '#b8d4ff',
		roughness: 0.05,
		clearcoat: 1,
		clearcoatRoughness: 0.04,
		emissive: '#16355e',
		emissiveIntensity: 0.5,
		alphaMode: 'blend',
		opacity: 0.24,
		doubleSided: true,
		forceSinglePass: true,
		depthWrite: false,
	});
	const rim = materials.standard({ color: '#0b1220', emissive: '#8ec8ff', emissiveIntensity: 3.2 });
	const rail = geometry.box({ width: PANE[0] + 4, height: 3, depth: 3 });
	const panes = PANES.map((place) => {
		const pane = scene.createMesh({
			mesh: geometry.plane({ width: PANE[0], height: PANE[1] }),
			material: glass,
			position: [place[0], PAGE_Y + place[1], place[2]],
			rotation: quat.fromEuler(quat.create(), 0, place[3], 0),
			dynamic: true,
		});
		for (const side of [1, -1])
			scene.createMesh({
				mesh: rail,
				material: rim,
				parent: pane,
				position: [0, (side * PANE[1]) / 2, 0],
			});
		return { pane, place };
	});

	return {
		onUpdate(dt) {
			// The camera sways across the page until the user takes it, so the page turns a little.
			const now = time.now;
			if (!view.userCamera) {
				camera.setPosition(Math.sin(now * 0.18) * 170, PAGE_Y + 20, 1150);
				camera.lookAt(0, PAGE_Y, 0);
			}
			for (const { pane, place } of panes) {
				const phase = now * 0.35 + place[0] * 0.01;
				pane.setPosition(
					place[0] + Math.sin(phase) * 24,
					PAGE_Y + place[1] + Math.cos(phase * 0.8) * 18,
					place[2],
				);
				pane.setRotationEuler(0, place[3] + Math.sin(phase) * 0.12, 0);
			}
			view.update(dt);
		},
	};
});
