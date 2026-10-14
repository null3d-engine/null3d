// A cinematic camera for the showcase scenes. In Auto, the camera follows a route of shots on a loop
// and shows the scene's best views; in Manual, the user flies the camera with the keyboard and the
// pointer, or with a finger on a touch screen. The `c` key toggles the two, and the `h` key hides
// the on-screen help. The current mode and the scene's keys go to the page as a `hud` message, since
// a sketch runs in a worker and cannot touch the page. The camera row of the help is a button, so a
// touch screen, which has no `c` key, can switch the mode too.
//
// Switching Auto to Manual is instant: the user takes the camera at once, exactly where it is, and
// the controls take their view from the pose they find. Switching Manual back to Auto does not
// snap: the camera finds the nearest point of the route, then glides to it over a short interval,
// easing in and out, and the route carries on from there.
//
// The route is a function of the sketch time, so a held frame (the image tests' `?hold`) lands on a
// fixed pose and never drifts. A scene whose held frame must not change puts the pose of that frame
// in the route's first shot and holds it still. Consecutive shots must differ: two shots at the same
// pose would stand the camera still for both, which reads as a stall.
import { createFirstPersonControls, type FirstPersonControls } from '@null3d/controls';
import { type PerspectiveCamera, quat, type SketchContext, vec3 } from '@null3d/engine';
import { createTouchGestures } from './touch-gestures';

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

/** One line of the on-screen help: the key, what it does, and an optional button that posts it. */
export interface HudRow {
	/** The key, such as `C`, as it shows on the help. */
	key: string;
	/** What the key does, and its state, such as `camera: auto`. */
	text: string;
	/**
	 * A message that the page sends to the sketch when the row is clicked, for a row that a touch
	 * screen can press with no keyboard. The page draws the row as a button.
	 */
	action?: { name: string; value?: string };
}

/** How `createCinematic` is called. */
export interface CinematicOptions {
	/** The shots of the route, in the order that the loop plays them. */
	shots: readonly Shot[];
	/** The mutable point that the camera looks at, which the depth-of-field lens focuses on. */
	target: [number, number, number];
	/** Rows for the help that the scene adds, such as its lens, read when the help is made again. */
	rows?: () => readonly HudRow[];
	/** How fast the manual camera moves, in meters per second. The default is 7. */
	speed?: number;
	/** How far ahead of the manual camera the lens focuses, in meters. The default is 14. */
	focusDistance?: number;
}

/** The cinematic camera of a showcase scene. */
export interface Cinematic {
	/** The mode now: `'auto'` follows the route, `'manual'` answers the user. */
	readonly mode: 'auto' | 'manual';
	/** Reads the frame's keys and, in Auto, moves the camera along the route. Call once per frame. */
	update(dt: number): void;
	/** Sends the help again, for a key that the scene answered itself. */
	refresh(): void;
	/** Switches between the route and the user's camera, as the `c` key and the help button do. */
	toggle(): void;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
/** Seconds to glide from the user's camera onto the route, after a switch back to Auto. */
const GLIDE = 1.5;
/** How finely the nearest point of the route is searched, in samples around the loop. */
const SAMPLES = 240;
/** How much the look-at target counts against the camera's position, in the search. */
const TARGET_WEIGHT = 0.6;

/**
 * Makes a cinematic camera. The scene gives the shots of its route and the point its lens focuses
 * on. In Manual the user flies: the keys move the camera, the pointer or a finger looks around, and
 * the same controls answer a touch screen through the engine's first-person controls.
 */
export function createCinematic(
	ctx: SketchContext,
	camera: PerspectiveCamera,
	options: CinematicOptions,
): Cinematic {
	const { input, time, page } = ctx;
	const { shots } = options;
	// The route's timeline: each shot's start and its length. A length below a millisecond is raised
	// to one, so the phase never divides by zero and never stands still for a whole shot.
	const starts: number[] = [];
	const lengths: number[] = [];
	let total = 0;
	for (const shot of shots) {
		starts.push(total);
		const length = Math.max(0.001, Number.isFinite(shot.seconds) ? shot.seconds : 0.001);
		lengths.push(length);
		total += length;
	}
	// The pose of the route at a phase: camera position, then the point it looks at.
	const sample = new Float32Array(6);
	const pose = new Float32Array(6);
	const from = new Float32Array(6);
	const glideTo = new Float32Array(6);
	const ahead = new Float32Array(3);
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

	// The manual camera: the engine's first-person controls. They walk with the keys, look with a
	// drag or the mouse, and answer a touch screen with a drag that looks and walks.
	const walk: FirstPersonControls = createFirstPersonControls(ctx, camera, {
		enabled: false,
		movementSpeed: options.speed ?? 7,
		lookSpeed: 0.12,
		dampingFactor: 0.16,
		lookVertical: true,
	});
	// Two fingers pinch to dolly, drag to pan and twist to turn, which the first-person controls do
	// not do. While they are down, those controls stand down, so one finger stays theirs.
	const gestures = createTouchGestures(ctx, camera);
	const forward = vec3.create();
	const turn = quat.create();

	/** Writes the route's pose at a phase into `out`. */
	const routePose = (phase: number, out: Float32Array): void => {
		const a = ((phase % total) + total) % total || 0;
		let index = 0;
		for (let k = 0; k < shots.length; k++) if (a >= (starts[k] as number)) index = k;
		const shot = shots[index] as Shot;
		const next = shots[(index + 1) % shots.length] as Shot;
		const along = (a - (starts[index] as number)) / (lengths[index] as number);
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

	/** Moves the camera to a pose, and points the lens at what it looks at. */
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
	};

	/** Sends the help to the page when it changed. */
	const postHelp = (force = false): void => {
		const rows: HudRow[] = [
			{ key: 'C', text: `camera: ${mode}`, action: { name: 'camera', value: 'toggle' } },
			...(options.rows?.() ?? []),
			...(mode === 'manual'
				? [
						{ key: 'move', text: 'W A S D, R F up, or one finger' },
						{ key: 'look', text: 'mouse drag, or one finger' },
						{ key: 'pinch', text: 'two fingers: zoom' },
						{ key: 'pan', text: 'two-finger drag: move across' },
						{ key: 'twist', text: 'two fingers: turn' },
					]
				: []),
			{ key: 'H', text: help ? 'hide help' : 'show help' },
		];
		const signature = `${help ? 1 : 0}|${rows.map((row) => `${row.key}:${row.text}`).join(',')}`;
		if (!force && signature === posted) return;
		posted = signature;
		page.post('hud', { rows, visible: help });
	};

	/** Switches the camera between the route and the user, as the `c` key and the button do. */
	const toggleMode = (): void => {
		if (mode === 'auto') {
			// Manual is instant: the user takes the camera exactly where it is. The controls read
			// their view from the pose, so the hand-over never jumps.
			mode = 'manual';
			glide = 1;
			camera.getPosition(from);
			camera.getRotation(turn);
			vec3.transformQuat(forward, [0, 0, -1], turn);
			walk.lookAt(
				(from[0] as number) + (forward[0] as number),
				(from[1] as number) + (forward[1] as number),
				(from[2] as number) + (forward[2] as number),
			);
			walk.enabled = true;
		} else {
			// Auto glides: find the nearest point of the route, then ease onto it.
			mode = 'auto';
			walk.enabled = false;
			camera.getPosition(from);
			from[3] = options.target[0];
			from[4] = options.target[1];
			from[5] = options.target[2];
			glideFrom = nearestPhase(from);
			routePose(glideFrom, glideTo);
			glide = 0;
		}
		postHelp(true);
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
		toggle() {
			toggleMode();
		},
		update(dt) {
			// Send the help again on the first frame, since the page binds its listener after the
			// sketch's setup runs.
			if (!announced) {
				announced = true;
				postHelp(true);
			}
			if (input.wasPressed('KeyC')) toggleMode();
			if (input.wasPressed('KeyH')) {
				help = !help;
				postHelp();
			}
			if (mode === 'manual') {
				// Two fingers are the gestures; one finger stays with the first-person controls.
				const twoFinger = gestures.update();
				walk.enabled = !twoFinger;
				if (!twoFinger) walk.update(dt);
				// The lens focuses a little ahead of where the camera looks, so the scene stays in
				// focus as the user moves.
				camera.getPosition(from);
				walk.getDirection(ahead);
				const focus = options.focusDistance ?? 14;
				options.target[0] = (from[0] as number) + (ahead[0] as number) * focus;
				options.target[1] = (from[1] as number) + (ahead[1] as number) * focus;
				options.target[2] = (from[2] as number) + (ahead[2] as number) * focus;
				return;
			}
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
