// Automatic exposure's scene: a gray floor, colored boxes and a bright lamp, lit by a sun and a
// little ambient light. ?light=dark lights it 5 stops below the camera's exposure, as a dark hall,
// and ?light=bright 3 stops above, as a sunny street; without it, the scene sits at the camera's
// exposure. ?auto turns automatic exposure on, with ?metering=mean for the mean meter, ?center= for
// the center weight, ?min= and ?max= for the eye's range and ?comp= for the compensation. ?bloom adds
// bloom with AgX, ?later turns automatic exposure on half a second in, ?scale= draws at that render
// scale, with a range that reaches down to 0.5; with ?fixed the range holds that scale alone, and
// the governor is off, for timing. ?meter=downsample asks for the downsample meter.
//
// On the page's 'dark' and 'bright' messages, the sun changes to the dark hall's or the street's,
// so a browser test can watch the eye adapt. On the 'exposure' message it turns automatic exposure
// on, waits until its pipelines are built, and posts 'settled'; 'exposure-off' turns it off. The
// effect cost page times it so.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** The sun's stops from the camera's exposure, by the scene's light. */
const STOPS = { dark: -5, bright: 3 };
const LIGHT = params.get('light');
const SUN_STOPS = LIGHT === 'dark' || LIGHT === 'bright' ? STOPS[LIGHT] : 0;
const AUTO = params.has('auto');
const LATER = params.has('later');
const SCALE = params.get('scale');
const METER = params.get('meter');
const FIXED = params.has('fixed');
/** True when the address asks for the mean meter. */
const MEAN = params.get('metering') === 'mean';
/** Each setting's value from the address, or null without it. */
const CENTER = params.get('center');
const MIN = params.get('min');
const MAX = params.get('max');
const COMP = params.get('comp');

/** The sun's intensity at the camera's exposure. */
const SUN = 2.5;

export default defineSketch(({ scene, materials, geometry, post, quality, time, page }) => {
	if (METER === 'downsample') quality.set({ exposureMeter: 'downsample' });
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	if (params.has('bloom'))
		post.set({ toneMapping: 'agx', bloom: { intensity: 0.1, threshold: 1 } });
	if (AUTO && !LATER)
		post.set({
			autoExposure: {
				metering: MEAN ? 'mean' : 'percentile',
				centerWeight: CENTER === null ? undefined : Number(CENTER),
				minEv: MIN === null ? undefined : Number(MIN),
				maxEv: MAX === null ? undefined : Number(MAX),
				compensation: COMP === null ? undefined : Number(COMP),
			},
		});
	scene.setBackground('#202830');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 2.2, 7],
		target: [0, 0.8, 0],
	});
	scene.setActiveCamera(camera);
	const sun = scene.createDirectionalLight({
		direction: [-0.4, -1, -0.6],
		color: '#fff4e0',
		intensity: SUN * 2 ** SUN_STOPS,
	});
	const ambient = scene.createAmbientLight({ color: '#a0b8ff', intensity: 0.3 * 2 ** SUN_STOPS });
	scene.createMesh({
		mesh: geometry.box({ width: 12, height: 0.2, depth: 12 }),
		material: materials.standard({ color: '#9a9a96', roughness: 0.8 }),
		position: [0, -0.1, 0],
	});
	const colors = ['#d04a3a', '#e8c040', '#3a8ad0', '#40b070', '#f0f0f0'];
	for (let k = 0; k < colors.length; k++) {
		const x = (k - 2) * 1.5;
		scene.createMesh({
			mesh: geometry.box({ width: 1, height: 1 + (k % 3) * 0.6, depth: 1 }),
			material: materials.standard({ color: colors[k], roughness: 0.5 }),
			position: [x, 0.5 + (k % 3) * 0.3, -0.5 * (k % 2)],
		});
	}
	// A lamp brighter than white, which the meter's percentiles leave out and bloom makes glow.
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.25 }),
		material: materials.standard({ color: '#000000', emissive: '#ffd890', emissiveIntensity: 12 }),
		position: [2.4, 2.4, -1.5],
	});
	page.onMessage((message) => {
		if (message === 'exposure-off') post.set({ autoExposure: false });
		if (message === 'exposure') {
			post.set({
				autoExposure: {
					metering: MEAN ? 'mean' : 'percentile',
					centerWeight: CENTER === null ? undefined : Number(CENTER),
					minEv: MIN === null ? undefined : Number(MIN),
					maxEv: MAX === null ? undefined : Number(MAX),
					compensation: COMP === null ? undefined : Number(COMP),
				},
			});
			void scene.warmUp().then(() => page.post('settled', null));
		}
		if (message !== 'dark' && message !== 'bright') return;

		sun.setIntensity(SUN * 2 ** STOPS[message]);
		ambient.setIntensity(0.3 * 2 ** STOPS[message]);
	});
	let turnedOn = false;
	return {
		onUpdate() {
			if (!AUTO || !LATER || turnedOn || time.now < 0.5) return;
			turnedOn = true;
			post.set({
				autoExposure: {
					metering: MEAN ? 'mean' : 'percentile',
					centerWeight: CENTER === null ? undefined : Number(CENTER),
					minEv: MIN === null ? undefined : Number(MIN),
					maxEv: MAX === null ? undefined : Number(MAX),
					compensation: COMP === null ? undefined : Number(COMP),
				},
			});
		},
	};
});
