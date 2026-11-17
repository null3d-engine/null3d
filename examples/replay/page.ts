// The demo's page part. It takes the player's input itself, steps the simulation by ticks, and sends
// the sketch the camera and the orbs that the simulation computed. The engine runs with
// `input: false`, so nothing of null3D listens: the keys, the mouse, the fingers and the pointer
// lock are this page's own, as they are the code's that records a game's input. Each tick's input
// goes into a log. Replay steps a new run from the seed through the log, at the same rate, and it
// ends on the state that the run had, so it ends on the same picture.
import type { DemoPage } from '../lib/run';
import {
	BACK,
	FORWARD,
	INPUT_NUMBERS,
	LEFT,
	ORBS,
	RIGHT,
	type Run,
	sameRun,
	startRun,
	step,
	TICK_HZ,
} from './sim';
import { BEFORE, BETWEEN, CAUGHT, NOW, VIEW_NUMBERS } from './view';

/** The keys that walk, as the simulation's bits. */
const KEYS: Readonly<Record<string, number>> = {
	KeyW: FORWARD,
	ArrowUp: FORWARD,
	KeyS: BACK,
	ArrowDown: BACK,
	KeyA: LEFT,
	ArrowLeft: LEFT,
	KeyD: RIGHT,
	ArrowRight: RIGHT,
};
const TICK_MS = 1000 / TICK_HZ;
/** The most time that one frame steps, so a page that was hidden does not race to catch up. */
const MOST_MS = 250;
/** How far a press may move, in CSS pixels, and still count as a click that asks for the lock. */
const CLICK_PX = 4;
/** How long the replay's verdict shows, in ticks of the run that goes on after it. */
const VERDICT_TICKS = 4 * TICK_HZ;

/** Writes a run's pose, its eye and its view's rotation, into the view from `at`. */
function writePose(view: Float64Array, at: number, run: Run): void {
	view.set(run.position, at);
	view.set(run.look, at + 3);
}

/** Starts the page part: see `DemoPage` in `examples/lib/run.ts`. */
export const start: DemoPage['start'] = (engine, canvas, controls, signal) => {
	const listen: AddEventListenerOptions = signal ? { signal } : {};
	let run = startRun();
	let log: number[] = [];
	let replaying: Run | undefined;
	let replayAt = 0;
	// The input since the last tick: the keys held, and the mouse's movement in CSS pixels.
	let keys = 0;
	let turn = 0;
	let tilt = 0;
	let locked = false;
	let looking = -1;
	let lastX = 0;
	let lastY = 0;
	let downX = 0;
	let downY = 0;
	const fingers = new Set<number>();

	window.addEventListener(
		'keydown',
		(event) => {
			const bit = KEYS[event.code];
			if (bit === undefined) return;
			keys |= bit;
			// The arrow keys walk rather than scroll the page.
			event.preventDefault();
		},
		listen,
	);
	window.addEventListener('keyup', (event) => (keys &= ~(KEYS[event.code] ?? 0)), listen);
	window.addEventListener('blur', () => (keys = 0), listen);
	// The pointer lock is the page's own: a click that drags nothing asks for it, and the mouse then
	// turns the view. A finger turns it by dragging, so the page scrolls nothing under it.
	canvas.style.touchAction = 'none';
	document.addEventListener(
		'pointerlockchange',
		() => (locked = document.pointerLockElement === canvas),
		listen,
	);
	// Without the lock, the first pointer down drags the view, and a second finger walks forward.
	canvas.addEventListener(
		'pointerdown',
		(event) => {
			if (event.pointerType === 'touch') fingers.add(event.pointerId);
			if (looking >= 0) return;
			looking = event.pointerId;
			lastX = downX = event.clientX;
			lastY = downY = event.clientY;
			canvas.setPointerCapture(event.pointerId);
		},
		listen,
	);
	canvas.addEventListener(
		'pointermove',
		(event) => {
			if (locked) {
				turn += event.movementX;
				tilt += event.movementY;
			} else if (event.pointerId === looking) {
				turn += event.clientX - lastX;
				tilt += event.clientY - lastY;
				lastX = event.clientX;
				lastY = event.clientY;
			}
		},
		listen,
	);
	const lift = (event: PointerEvent) => {
		fingers.delete(event.pointerId);
		if (event.pointerId !== looking) return;
		looking = -1;
		const still = Math.hypot(event.clientX - downX, event.clientY - downY) < CLICK_PX;
		if (event.type === 'pointerup' && event.pointerType === 'mouse' && still && !locked)
			canvas.requestPointerLock()?.catch(() => {});
	};
	canvas.addEventListener('pointerup', lift, listen);
	canvas.addEventListener('pointercancel', lift, listen);

	// The buttons and the run's state, in the element that holds a demo's choices.
	const group = document.createElement('div');
	group.className = 'choice';
	group.setAttribute('role', 'group');
	group.setAttribute('aria-label', 'Run');
	const label = document.createElement('span');
	label.textContent = 'Run';
	const status = document.createElement('span');
	status.setAttribute('aria-live', 'polite');
	const button = (text: string, press: () => void) => {
		const made = document.createElement('button');
		made.type = 'button';
		made.textContent = text;
		made.setAttribute('aria-pressed', 'false');
		made.addEventListener('click', press);
		return made;
	};
	const replayButton = button('Replay', () => {
		if (replaying || log.length === 0) return;
		replaying = startRun();
		replayAt = 0;
		replayButton.setAttribute('aria-pressed', 'true');
	});
	const restart = button('Restart', () => {
		run = startRun();
		log = [];
		replaying = undefined;
		replayButton.setAttribute('aria-pressed', 'false');
	});
	group.append(label, restart, replayButton, status);
	controls?.append(group);
	signal?.addEventListener('abort', () => group.remove());

	let verdict = '';
	let verdictUntil = 0;
	let shown = '';
	const say = (text: string) => {
		if (text !== shown) status.textContent = shown = text;
	};
	const seconds = (numbers: number) => (numbers / INPUT_NUMBERS / TICK_HZ).toFixed(1);
	const view = new Float64Array(VIEW_NUMBERS);
	writePose(view, NOW, run);

	/** One tick: the live run takes the input and logs it, or the replay takes the log's next tick. */
	const tick = () => {
		writePose(view, BEFORE, replaying ?? run);
		if (!replaying) {
			const whole = Math.trunc(turn);
			const steep = Math.trunc(tilt);
			turn -= whole;
			tilt -= steep;
			log.push(keys | (fingers.size > 1 ? FORWARD : 0), whole, steep);
			step(run, log[log.length - 3] as number, whole, steep);
		} else {
			const at = replayAt;
			step(replaying, log[at] as number, log[at + 1] as number, log[at + 2] as number);
			replayAt += INPUT_NUMBERS;
			if (replayAt >= log.length) {
				// The replay ran every logged tick from the seed: its state is the run's, bit for bit.
				verdict = sameRun(replaying, run)
					? 'Replay ended on the same state'
					: 'Replay ended on another state';
				verdictUntil = run.tick + VERDICT_TICKS;
				replaying = undefined;
				turn = 0;
				tilt = 0;
				replayButton.setAttribute('aria-pressed', 'false');
			}
		}
		writePose(view, NOW, replaying ?? run);
	};
	let last = performance.now();
	let carry = 0;
	const frame = (now: number) => {
		if (signal?.aborted) return;
		carry = Math.min(carry + now - last, MOST_MS);
		last = now;
		while (carry >= TICK_MS) {
			carry -= TICK_MS;
			tick();
		}
		const shownRun = replaying ?? run;
		view[BETWEEN] = carry / TICK_MS;
		let caught = 0;
		for (let i = 0; i < ORBS; i++) if ((shownRun.caught[i] as number) >= 0) caught |= 1 << i;
		view[CAUGHT] = caught;
		// A copy each frame: a sketch on the page's thread gets the very array that the page sends.
		engine.postToSketch('view', view.slice());
		if (replaying) say(`Replaying ${seconds(replayAt)} of ${seconds(log.length)} s`);
		else if (run.tick < verdictUntil) say(verdict);
		else say(`${run.score} of ${ORBS} orbs`);
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
};
