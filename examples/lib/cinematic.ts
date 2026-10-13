// A cinematic camera for the showcase scenes. In Auto, the camera follows a route of shots on a loop
// and shows the scene's best views; in Manual, the orbit controls answer the user. The `c` key
// toggles the two, and the `h` key hides the on-screen help. The current mode and the scene's keys
// go to the page as a `hud` message, since a sketch runs in a worker and cannot touch the page.
//
// Switching Auto to Manual is instant: the user takes the camera at once. Switching Manual back to
// Auto does not snap: the camera finds the nearest point of the route, then glides to it over a
// short interval, easing in and out, and the route carries on from there.
//
// The route is a function of the sketch time, so a held frame (the image tests' `?hold`) lands on a
// fixed pose and never drifts. A scene whose held frame must not change puts the pose of that frame
// in the route's first shot and holds it still.
import type { PerspectiveCamera, SketchContext } from '@null3d/engine';
import type { Interaction } from './interact';

/** One shot of a route: where the camera stands, what it looks at, and how long the shot lasts. */
export interface Shot {
	/** The camera's position, in meters. */
	position: readonly [number, number, number];
	/** The point that the camera looks at, in meters. */
	target: readonly [number, number, number];
	/** How long the shot lasts, in seconds. The loop's length is the sum of its shots. */
	seconds: number;
	/**
	 * `'hold'` keeps the camera still for the shot, and `'ease'` moves it toward the next shot's
	 * pose over the shot, so the route flows. The default is `'ease'`.
	 */
	move?: 'hold' | 'ease';
}

/** One line of the on-screen help: the key, and what it does. */
export interface HudRow {
	/** The key, such as `C`, as it shows on the help. */
	key: string;
	/** What the key does, and its state, such as `camera: auto`. */
	text: string;
}

/** How `createCinematic` is called. */
export interface CinematicOptions {
	/** The shots of the route, in the order that the loop plays them. */
	shots: readonly Shot[];
	/** The mutable point that the camera looks at, which the manual orbit controls turn around. */
	target: [number, number, number];
	/** Rows for the help that the scene adds, such as its lens, read when the help is made again. */
	rows?: () => readonly HudRow[];
}

/** The cinematic camera of a showcase scene. */
export interface Cinematic {
	/** The mode now: `'auto'` follows the route, `'manual'` answers the user. */
	readonly mode: 'auto' | 'manual';
	/** Reads the frame's keys and, in Auto, moves the camera along the route. Call once per frame. */
	update(dt: number): void;
	/** Sends the help again, for a key that the scene answered itself. */
	refresh(): void;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
/** Seconds to glide from the user's camera onto the route, after a switch back to Auto. */
const GLIDE = 1.5;
/** How finely the nearest point of the route is searched, in samples around the loop. */
const SAMPLES = 240;
/** How much the look-at target counts against the camera's position, in the search. */
const TARGET_WEIGHT = 0.6;

/**
 * Makes a cinematic camera. The scene draws its own orbit controls through `view` for Manual mode,
 * and gives the shots of its route. In Manual the sketch still calls `view.update`; in Auto the route
 * moves the camera and the user's gestures do not take it.
 */
export function createCinematic(
	{ input, time, page }: SketchContext,
	camera: PerspectiveCamera,
	view: Interaction,
	options: CinematicOptions,
): Cinematic {
	const { shots } = options;
	const starts: number[] = [];
	let total = 0;
	for (const shot of shots) {
		starts.push(total);
		total += Math.max(0.001, shot.seconds);
	}
	// The pose of the route at a phase: camera position, then the point it looks at.
	const sample = new Float32Array(6);
	const pose = new Float32Array(6);
	const from = new Float32Array(6);
	const glideTo = new Float32Array(6);
	let mode: 'auto' | 'manual' = 'auto';
	let help = true;
	/** The shift that keeps the route's phase, after a glide has landed on it. */
	let phaseShift = 0;
	/** How far the glide has gone, from 0 to 1; 1 means the route drives the camera. */
	let glide = 1;
	/** The phase that a glide resumes from. */
	let glideFrom = 0;
	let posted = '';
	let announced = false;

	/** Writes the route's pose at a phase into `out`. */
	const routePose = (phase: number, out: Float32Array): void => {
		const a = ((phase % total) + total) % total;
		let index = 0;
		for (let k = 0; k < shots.length; k++) if (a >= (starts[k] as number)) index = k;
		const shot = shots[index] as Shot;
		const next = shots[(index + 1) % shots.length] as Shot;
		const along = (a - (starts[index] as number)) / shot.seconds;
		const f = shot.move === 'hold' ? 0 : smooth(Math.min(1, Math.max(0, along)));
		for (let c = 0; c < 3; c++) {
			const p = shot.position[c] as number;
			const t = shot.target[c] as number;
			out[c] = p + ((next.position[c] as number) - p) * f;
			out[3 + c] = t + ((next.target[c] as number) - t) * f;
		}
	};

	/** The phase of the route whose pose is nearest to `at`, weighing the position and the target. */
	const nearestPhase = (at: Float32Array): number => {
		let best = 0;
		let bestCost = Infinity;
		for (let k = 0; k < SAMPLES; k++) {
			const phase = (k / SAMPLES) * total;
			routePose(phase, sample);
			let cost = 0;
			for (let c = 0; c < 3; c++) {
				cost += ((sample[c] as number) - (at[c] as number)) ** 2;
				cost += TARGET_WEIGHT * ((sample[3 + c] as number) - (at[3 + c] as number)) ** 2;
			}
			if (cost < bestCost) {
				bestCost = cost;
				best = phase;
			}
		}
		return best;
	};

	/** Moves the camera to a pose, and points the manual controls' target at what it looks at. */
	const apply = (p: Float32Array): void => {
		const px = p[0] as number;
		const py = p[1] as number;
		const pz = p[2] as number;
		const tx = p[3] as number;
		const ty = p[4] as number;
		const tz = p[5] as number;
		camera.setPosition(px, py, pz);
		camera.lookAt(tx, ty, tz);
		options.target[0] = tx;
		options.target[1] = ty;
		options.target[2] = tz;
		view.controls.target[0] = tx;
		view.controls.target[1] = ty;
		view.controls.target[2] = tz;
	};

	/** Sends the help to the page when it changed. */
	const postHelp = (force = false): void => {
		const rows: HudRow[] = [
			{ key: 'C', text: `camera: ${mode}` },
			...(options.rows?.() ?? []),
			{ key: 'H', text: help ? 'hide help' : 'show help' },
		];
		const signature = `${help ? 1 : 0}|${rows.map((row) => `${row.key}:${row.text}`).join(',')}`;
		if (!force && signature === posted) return;
		posted = signature;
		page.post('hud', { rows, visible: help });
	};

	// Send the help once, so the page shows the keys before the first change.
	postHelp(true);

	return {
		get mode() {
			return mode;
		},
		refresh() {
			postHelp(true);
		},
		update(dt) {
			// Send the help again on the first frame, since the page binds its listener after the
			// sketch's setup runs.
			if (!announced) {
				announced = true;
				postHelp(true);
			}
			if (input.wasPressed('KeyC')) {
				if (mode === 'auto') {
					// Manual is instant: the user takes the camera where it is.
					mode = 'manual';
					glide = 1;
				} else {
					// Auto glides: find the nearest point of the route, then ease onto it.
					mode = 'auto';
					camera.getPosition(from);
					from[3] = options.target[0];
					from[4] = options.target[1];
					from[5] = options.target[2];
					glideFrom = nearestPhase(from);
					routePose(glideFrom, glideTo);
					glide = 0;
				}
				postHelp();
			}
			if (input.wasPressed('KeyH')) {
				help = !help;
				postHelp();
			}
			if (mode === 'manual') return;
			if (glide < 1) {
				// Ease from the user's pose onto the route point, then carry on from that phase.
				glide = Math.min(1, glide + dt / GLIDE);
				const b = smooth(glide);
				for (let c = 0; c < 6; c++)
					pose[c] = (from[c] as number) + ((glideTo[c] as number) - (from[c] as number)) * b;
				if (glide >= 1) phaseShift = glideFrom - time.now;
			} else {
				routePose(time.now + phaseShift, pose);
			}
			apply(pose);
		},
	};
}
