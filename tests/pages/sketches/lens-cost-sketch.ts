// The lens kit's cost, for the effect cost page: a wall of small boxes under bloom, with bright
// bars at its top, so the grade, the sharpening, the vignette, the color fringes, the streak, the
// grain and the speed blur all work on the frame that is timed. On the page's 'lens' message it
// applies the whole look, waits until its pipelines are built, and posts 'settled'. The
// 'lens-off' message drops the look again, which removes the add-on's effect as well.
// ?scale= draws at that render scale, and ?fixed holds that scale alone with the governor off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import { createLensKit, type LensLook } from '../../../examples/addons/lens-kit/index';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');
/** Boxes along each side of the wall that covers the view. */
const WALL = 32;

/** The look whose cost the page times. */
const LOOK: LensLook = {
	sharpen: 0.6,
	vignette: { intensity: 0.6, size: 1.0, falloff: 2.2 },
	grading: {
		whiteBalance: { temperature: 5200 },
		lift: [0.02, 0.02, 0.03],
		gain: [1.08, 1.0, 0.94],
		saturation: 1.25,
		splitToning: { shadows: '#3050ff', highlights: '#ffb45a', strength: 0.3 },
	},
	bloomLevel: 3,
	aberration: 2,
	streak: 0.5,
	grain: 0.06,
	speedBlur: 0.2,
};
/** No look: every core setting off and every mark at 0, which also drops the effect. */
const OFF: LensLook = {
	sharpen: false,
	vignette: false,
	grading: false,
	aberration: 0,
	streak: 0,
	grain: 0,
	speedBlur: 0,
};

/** A strong grade, so the colors move plainly against the picture without one. */
const GRADE = {
	whiteBalance: { temperature: 3600 },
	lift: [0.02, 0.02, 0.04] as const,
	gain: [1.12, 1.0, 0.9] as const,
	saturation: 1.7,
	splitToning: { shadows: '#2f4fff', highlights: '#ffb45a', strength: 0.5 },
};
/**
 * One mark alone, with every other value at 0, so each mark's own cost shows. `?look=` names the
 * mark; without it the whole look is timed.
 */
const MARKS: Record<string, LensLook> = {
	grade: { grading: GRADE },
	vignette: { vignette: { intensity: 0.8, size: 1.0, falloff: 2 } },
	sharpen: { sharpen: 0.8 },
	aberration: { aberration: 8 },
	streak: { streak: 0.6, bloomLevel: 3 },
	grain: { grain: 0.25 },
	speed: { speedBlur: 0.5 },
};
const MARK = params.get('look');
const CHOSEN = MARK === null ? LOOK : MARKS[MARK];
if (CHOSEN === undefined) throw new Error(`the lens kit has no mark ${MARK}`);

export default defineSketch((ctx) => {
	const { scene, materials, geometry, post, quality, page } = ctx;
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	// Bloom lights the streak, and it stays on for both sides, so only the lens's own cost is timed.
	post.set({ bloom: { intensity: 0.5, threshold: 1 } });
	scene.setBackground('#0e1420');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 50,
			near: 0.1,
			far: 100,
			position: [0, 0, 10],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-1, -1.5, -2], color: '#ffffff', intensity: 2.5 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.6 });
	const box = geometry.box({ width: 1, height: 1, depth: 1 });
	const light = materials.standard({ color: '#d8c8a8', roughness: 0.6, metalness: 0 });
	const dark = materials.standard({ color: '#33425c', roughness: 0.6, metalness: 0 });
	const red = materials.standard({ color: '#c83422', roughness: 0.6, metalness: 0 });
	// The view is about 9.3 units high at the wall's distance, and wider: the wall reaches past it.
	const step = 16 / WALL;
	for (let i = 0; i < WALL; i++)
		for (let j = 0; j < WALL; j++)
			scene.createMesh({
				mesh: box,
				material: j % 9 === 4 ? red : (i + j) % 2 === 0 ? light : dark,
				position: [(i - (WALL - 1) / 2) * step, (j - (WALL - 1) / 2) * step, 0],
				scale: [step, step, step],
			});
	// Bars brighter than white, for bloom and for the streak that spreads bloom's own glow.
	const glow = materials.standard({
		color: '#000000',
		emissive: '#ffffff',
		emissiveIntensity: 6,
		roughness: 1,
		metalness: 0,
	});
	const bar = geometry.box({ width: 0.12, height: 0.6, depth: 0.1 });
	for (const x of [-1.6, 0, 1.6])
		scene.createMesh({ mesh: bar, material: glow, position: [x, 3, 0.6] });
	const lens = createLensKit(ctx, OFF);
	page.onMessage((message) => {
		if (message === 'lens-off') {
			lens.set(OFF);
			return;
		}
		if (message !== 'lens') return;
		lens.set(CHOSEN);
		void scene.warmUp().then(() => page.post('settled', {}));
	});
	return {};
});
