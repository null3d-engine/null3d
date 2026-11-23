// The speaker button of a demo whose sketch plays sound with `@null3d/sound`. It sits over the
// canvas's top right corner, beside the engine's frame rate, and connects the page's half of the
// sound. The sound is on by default: the page starts it as the demo loads. A browser that holds a
// page's audio until the user acts plays it from the visitor's first click, tap or key. A press of
// the button turns the sound off or on, and local storage keeps that choice for every demo, so a
// visitor who turned it off finds it off in the next demo and on the next visit.
import type { Engine } from '@null3d/engine';
import { connectSound, type PageSound } from '@null3d/sound/page';

/** The key in local storage that holds the visitor's choice: 'off', or 'on' after a press. */
const CHOICE_KEY = 'null3d-demos-sound';

/** The speaker's outline, and the waves or the cross that it shows. */
const SPEAKER = 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z';
const WAVES = 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11';
const CROSS = 'M16 9.5l5 5M21 9.5l-5 5';

/** True unless the visitor turned the sound off. A page that may not read storage plays it. */
function soundChosen(): boolean {
	try {
		return localStorage.getItem(CHOICE_KEY) !== 'off';
	} catch {
		return true;
	}
}

/** Keeps the visitor's choice. A page that may not write storage keeps it for this demo alone. */
function keepChoice(on: boolean): void {
	try {
		localStorage.setItem(CHOICE_KEY, on ? 'on' : 'off');
	} catch {
		// Storage that is full or refused leaves the choice to this page.
	}
}

/** One stroked path of the icon. */
function stroke(d: string): SVGPathElement {
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', d);
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', '1.8');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	return path;
}

/**
 * Adds the speaker button over the canvas in `stage`, connects the page's sound and starts it
 * unless the visitor turned it off. The button and the sound end with `signal`, and the sound
 * ends with the engine.
 */
export function addSoundButton(engine: Engine, stage: HTMLElement, signal: AbortSignal): PageSound {
	let on = soundChosen();
	const sound = connectSound(engine, { muted: !on });
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'sound-toggle';
	const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	icon.setAttribute('viewBox', '0 0 24 24');
	icon.setAttribute('width', '20');
	icon.setAttribute('height', '20');
	icon.setAttribute('fill', 'none');
	icon.setAttribute('aria-hidden', 'true');
	const waves = stroke(WAVES);
	const cross = stroke(CROSS);
	icon.append(stroke(SPEAKER), waves, cross);
	button.append(icon);
	/** Shows the visitor's choice: waves while the sound is on, a cross while it is off. */
	const show = () => {
		waves.style.display = on ? '' : 'none';
		cross.style.display = on ? 'none' : '';
		button.setAttribute('aria-pressed', String(on));
		const label = on ? 'Turn the sound off' : 'Turn the sound on';
		button.setAttribute('aria-label', label);
		button.title = label;
	};
	button.addEventListener('click', () => {
		on = !on;
		keepChoice(on);
		sound.setMuted(!on);
		// A sound that never started, or that the browser holds, starts in this press, which is
		// what lets the browser play it.
		if (on) void sound.start();
		show();
	});
	show();
	stage.append(button);
	// Outside a press, the browser may hold the audio: the add-on then starts it at the visitor's
	// first click, tap or key anywhere on the page.
	if (on) void sound.start();
	signal.addEventListener(
		'abort',
		() => {
			sound.stop();
			button.remove();
		},
		{ once: true },
	);
	return sound;
}
