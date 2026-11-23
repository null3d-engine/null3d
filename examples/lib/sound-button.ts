// The speaker button of a demo whose sketch plays sound with `@null3d/sound`. It sits beside the
// controls' chevron and connects the page's half of the sound. A browser starts a page's audio only
// in answer to the user, so the button's first press starts the sound and later presses mute and
// unmute it. A demo starts silent, so a visitor hears nothing until they ask.
import type { Engine } from '@null3d/engine';
import { connectSound, type PageSound } from '@null3d/sound/page';

/** The speaker's outline, and the waves or the cross that it shows. */
const SPEAKER = 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z';
const WAVES = 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11';
const CROSS = 'M16 9.5l5 5M21 9.5l-5 5';

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
 * Adds the speaker button to the demo's controls element and connects the page's sound. The button
 * and the sound end with `signal`, and the sound ends with the engine.
 */
export function addSoundButton(engine: Engine, hud: HTMLElement, signal: AbortSignal): PageSound {
	const sound = connectSound(engine);
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'hud__sound';
	const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	icon.setAttribute('viewBox', '0 0 24 24');
	icon.setAttribute('width', '22');
	icon.setAttribute('height', '22');
	icon.setAttribute('fill', 'none');
	icon.setAttribute('aria-hidden', 'true');
	const waves = stroke(WAVES);
	const cross = stroke(CROSS);
	icon.append(stroke(SPEAKER), waves, cross);
	button.append(icon);
	/** Shows whether the sound plays: waves while it does, a cross while it is off or muted. */
	const show = () => {
		const playing =
			(sound.state === 'on' || sound.state === 'paused' || sound.state === 'interrupted') &&
			!sound.muted;
		waves.style.display = playing ? '' : 'none';
		cross.style.display = playing ? 'none' : '';
		button.setAttribute('aria-pressed', String(playing));
		const label = playing ? 'Mute the sound' : 'Play the sound';
		button.setAttribute('aria-label', label);
		button.title = label;
	};
	button.addEventListener('click', () => {
		if (sound.state === 'on' || sound.state === 'paused') sound.setMuted(!sound.muted);
		else if (sound.state === 'off' || sound.state === 'interrupted') {
			// The audio starts, or comes back after the browser held it, in this press, which is what
			// lets the browser play it. The press does not also mute it.
			void sound.start();
		}
		show();
	});
	sound.onState(show);
	show();
	hud.append(button);
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
