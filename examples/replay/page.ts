// The demo's page part. It takes the player's input itself, steps the simulation by ticks, and sends
// the sketch the camera and the orbs that the simulation computed. The engine runs with
// `input: false`, so nothing of null3D listens: the keys, the mouse, the fingers and the pointer
// lock are this page's own, as they are the code's that records a game's input. Each tick's input
// goes into a log. Replay steps a new run from the seed through the log, at the same rate, and it
// ends on the state that the run had, so it ends on the same picture. The play itself, without the
// page, is session.ts.
import type { DemoPage } from '../lib/run';
import { Session, TickClock } from './session';
import { BACK, FORWARD, LEFT, RIGHT } from './sim';

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
/** How far a press may move, in CSS pixels, and still count as a click that asks for the lock. */
const CLICK_PX = 4;

/** Starts the page part: see `DemoPage` in `examples/lib/run.ts`. */
export const start: DemoPage['start'] = (engine, canvas, controls, signal) => {
	const listen: AddEventListenerOptions = { signal };
	const session = new Session();
	// The input since the last tick: the keys held, and the mouse's movement in CSS pixels.
	let keys = 0;
	let turn = 0;
	let tilt = 0;
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
	// turns the view. A finger turns it by dragging, so the page scrolls nothing under it. The lock
	// is read where it matters, because a press can come before the lock's change event does.
	canvas.style.touchAction = 'none';
	const locked = () => document.pointerLockElement === canvas;
	// Without the lock, the first pointer down drags the view, and a second finger walks forward.
	canvas.addEventListener(
		'pointerdown',
		(event) => {
			if (event.pointerType === 'touch') fingers.add(event.pointerId);
			// Under the lock the mouse turns the view by its movement, and the browser refuses a capture.
			if (locked() || looking >= 0) return;
			looking = event.pointerId;
			lastX = downX = event.clientX;
			lastY = downY = event.clientY;
			try {
				canvas.setPointerCapture(event.pointerId);
			} catch {
				// The pointer is no longer active, or the lock began meanwhile: no drag to keep.
			}
		},
		listen,
	);
	canvas.addEventListener(
		'pointermove',
		(event) => {
			if (locked()) {
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
		if (event.type === 'pointerup' && event.pointerType === 'mouse' && still && !locked())
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
	const replayButton = button('Replay', () => session.replay());
	const restart = button('Restart', () => session.restart());
	group.append(label, restart, replayButton, status);
	controls?.append(group);
	signal.addEventListener('abort', () => group.remove());

	const clock = new TickClock(performance.now());
	const frame = (now: number) => {
		if (signal.aborted) return;
		for (let due = clock.due(now); due > 0; due--) {
			const whole = Math.trunc(turn);
			const steep = Math.trunc(tilt);
			turn -= whole;
			tilt -= steep;
			session.tick(keys | (fingers.size > 1 ? FORWARD : 0), whole, steep);
		}
		// Input that came while a replay ran belongs to no tick.
		if (session.replays) turn = tilt = 0;
		// A copy each frame: a sketch on the page's thread gets the very array that the page sends.
		engine.postToSketch('view', session.frame(clock.between).slice());
		replayButton.setAttribute('aria-pressed', String(session.replays));
		const line = session.status();
		if (status.textContent !== line) status.textContent = line;
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
};
