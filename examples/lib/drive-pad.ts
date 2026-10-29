// The on-screen driving pad of a scene that the user drives, for a touch screen, which has no keys.
// A thumb stick at the bottom left speeds up, brakes and turns, and buttons at the bottom right
// climb, sink and switch the view. The scene asks for the pad while the user drives, with a
// `drive-pad` message, and the page shows it only where a finger is the main pointer.
//
// The pad sends the stick's place and the held buttons to the sketch as one `drive` message, three
// numbers from -1 to 1: the throttle, the steer to the left and the lift. It sends them only when
// they change, in steps of a twentieth, so a drag costs the sketch a few messages a second. The View
// button sends `view` with `toggle`.

/** How far the knob travels from the stick's middle, in CSS pixels. */
const REACH = 46;
/** The step that the pad rounds its values to, so a drag sends few messages. */
const STEP = 0.05;

/** The driving pad of a page. */
export interface DrivePad {
	/** Shows the pad while `on` and a finger is the main pointer, or hides it and lets go. */
	show(on: boolean): void;
	/** Removes the pad and its listeners. */
	dispose(): void;
}

/** Makes an element with a class and, for a button, its label. */
function part<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, label?: string) {
	const element = document.createElement(tag);
	element.className = className;
	if (label !== undefined) element.textContent = label;
	return element;
}

/**
 * Makes the driving pad over `stage`, before `before` so the controls panel stays above it. `post`
 * sends a message to the sketch.
 */
export function createDrivePad(
	stage: HTMLElement,
	before: Element | null,
	post: (name: string, value: string) => void,
): DrivePad {
	const listeners = new AbortController();
	const { signal } = listeners;
	const root = part('div', 'pad');
	root.hidden = true;
	const stick = part('div', 'pad__stick');
	stick.setAttribute('role', 'application');
	stick.setAttribute('aria-label', 'Drive: up speeds up, down brakes, left and right turn');
	const knob = part('div', 'pad__knob');
	stick.append(knob);
	const buttons = part('div', 'pad__buttons');
	const climb = part('button', 'pad__btn', 'Climb');
	const sink = part('button', 'pad__btn', 'Sink');
	const view = part('button', 'pad__btn pad__btn--small', 'View');
	for (const button of [climb, sink, view]) button.type = 'button';
	buttons.append(view, climb, sink);
	root.append(stick, buttons);
	stage.insertBefore(root, before);

	let throttle = 0;
	let steer = 0;
	let lift = 0;
	let sent = '0 0 0';
	/** Sends the pad's values when they differ from the last ones sent. */
	const send = (): void => {
		const round = (value: number) => Math.round(value / STEP) * STEP;
		const next = `${round(throttle).toFixed(2)} ${round(steer).toFixed(2)} ${round(lift).toFixed(2)}`;
		if (next === sent) return;
		sent = next;
		post('drive', next);
	};

	// The stick follows one finger from its press to its release, wherever the finger goes.
	let finger = -1;
	const moveKnob = (event: PointerEvent): void => {
		const box = stick.getBoundingClientRect();
		let dx = event.clientX - (box.left + box.width / 2);
		let dy = event.clientY - (box.top + box.height / 2);
		const length = Math.hypot(dx, dy);
		if (length > REACH) {
			dx *= REACH / length;
			dy *= REACH / length;
		}
		knob.style.transform = `translate(${dx}px, ${dy}px)`;
		throttle = -dy / REACH;
		steer = -dx / REACH;
		send();
	};
	const releaseKnob = (): void => {
		finger = -1;
		knob.style.transform = '';
		stick.classList.remove('pad__stick--held');
		throttle = 0;
		steer = 0;
		send();
	};
	stick.addEventListener(
		'pointerdown',
		(event) => {
			if (finger !== -1) return;
			finger = event.pointerId;
			stick.setPointerCapture(event.pointerId);
			stick.classList.add('pad__stick--held');
			moveKnob(event);
		},
		{ signal },
	);
	stick.addEventListener(
		'pointermove',
		(event) => {
			if (event.pointerId === finger) moveKnob(event);
		},
		{ signal },
	);
	for (const type of ['pointerup', 'pointercancel'] as const)
		stick.addEventListener(
			type,
			(event) => {
				if (event.pointerId === finger) releaseKnob();
			},
			{ signal },
		);

	// Climb and Sink act while a finger holds them.
	let climbing = false;
	let sinking = false;
	const hold = (button: HTMLButtonElement, set: (held: boolean) => void): void => {
		const press = (held: boolean) => (event: PointerEvent) => {
			if (held) button.setPointerCapture(event.pointerId);
			button.classList.toggle('pad__btn--held', held);
			set(held);
			lift = (climbing ? 1 : 0) - (sinking ? 1 : 0);
			send();
		};
		button.addEventListener('pointerdown', press(true), { signal });
		button.addEventListener('pointerup', press(false), { signal });
		button.addEventListener('pointercancel', press(false), { signal });
	};
	hold(climb, (held) => {
		climbing = held;
	});
	hold(sink, (held) => {
		sinking = held;
	});
	view.addEventListener('click', () => post('view', 'toggle'), { signal });

	/** True where a finger is the main pointer: a phone or a tablet. */
	const touch = matchMedia('(pointer: coarse)');
	return {
		show(on) {
			const shown = on && touch.matches;
			if (shown === !root.hidden) return;
			root.hidden = !shown;
			if (!shown) {
				releaseKnob();
				climbing = false;
				sinking = false;
				climb.classList.remove('pad__btn--held');
				sink.classList.remove('pad__btn--held');
				lift = 0;
				send();
			}
		},
		dispose() {
			listeners.abort();
			root.remove();
		},
	};
}
