// The add-on's page: it starts the engine on its canvas with the add-on's sketch, and connects the
// page's half of the sound. The listing check's gates run the page without a click, so it starts
// silent; the button, or any press on the page, starts the sound.
//
// The page makes its two sounds in code, as short loops of whole cycles, so the add-on ships no
// file. It hands their addresses to the sketch, which makes its sounds when they arrive.
//
// `?pause=<seconds>` pauses the engine that many seconds after the sound starts, for three seconds,
// so a check can hear the sound fade out with the frames and come back with them.
import { createEngine } from '@null3d/engine';
import { connectSound } from '../src/page.ts';

/** The page's sample rate for the made sounds. */
const RATE = 48_000;

/**
 * A loop of `seconds` of 16-bit mono sound, from a function of time, as a WAV file's address. Each
 * part of the sound repeats a whole number of times in the loop, so its ends meet with no click.
 */
function madeLoop(seconds: number, sample: (t: number) => number): string {
	const frames = Math.round(seconds * RATE);
	const bytes = new DataView(new ArrayBuffer(44 + frames * 2));
	const text = (at: number, value: string) => {
		for (let i = 0; i < value.length; i++) bytes.setUint8(at + i, value.charCodeAt(i));
	};
	text(0, 'RIFF');
	bytes.setUint32(4, 36 + frames * 2, true);
	text(8, 'WAVEfmt ');
	bytes.setUint32(16, 16, true);
	bytes.setUint16(20, 1, true);
	bytes.setUint16(22, 1, true);
	bytes.setUint32(24, RATE, true);
	bytes.setUint32(28, RATE * 2, true);
	bytes.setUint16(32, 2, true);
	bytes.setUint16(34, 16, true);
	text(36, 'data');
	bytes.setUint32(40, frames * 2, true);
	for (let i = 0; i < frames; i++) {
		const value = Math.max(-1, Math.min(1, sample(i / RATE)));
		bytes.setInt16(44 + i * 2, value * 32767 * 0.5, true);
	}
	return URL.createObjectURL(new Blob([bytes.buffer], { type: 'audio/wav' }));
}

const TAU = Math.PI * 2;
/** A low hum of a few harmonics of 110 Hz, with a slow beat. */
const hum = madeLoop(2, (t) => {
	const beat = 0.75 + 0.25 * Math.sin(TAU * 1 * t);
	return (
		beat *
		(0.5 * Math.sin(TAU * 110 * t) + 0.3 * Math.sin(TAU * 220 * t) + 0.15 * Math.sin(TAU * 330 * t))
	);
});
/** A thin buzz near 420 Hz, wobbling a little. */
const buzz = madeLoop(1, (t) => {
	const wobble = Math.sin(TAU * 6 * t);
	return 0.6 * Math.sin(TAU * 420 * t + 0.8 * wobble) * (0.7 + 0.3 * Math.sin(TAU * 30 * t));
});

const canvas = document.querySelector('canvas');
const button = document.querySelector<HTMLButtonElement>('#sound');
if (!canvas || !button) throw new Error('the page has no canvas or no button');
const engine = await createEngine({ canvas, sketch: new URL('./sketch.ts', import.meta.url) });
engine.postToSketch('files', { hum, buzz });
const sound = connectSound(engine, { startOnInput: true });
/** The button's label for the sound's state: start it, or mute and unmute it once it runs. */
const label = () => {
	const running = sound.state === 'on' || sound.state === 'paused';
	button.textContent = running ? (sound.muted ? 'Unmute' : 'Mute') : 'Sound on';
};
sound.onState(label);
button.addEventListener('click', () => {
	// The page's first press also reaches the start on input, so a starting sound only starts.
	if (sound.state === 'on' || sound.state === 'paused') sound.setMuted(!sound.muted);
	else void sound.start();
	label();
});
const pause = Number(new URL(location.href).searchParams.get('pause') ?? Number.NaN);
if (pause >= 0) {
	const off = sound.onState((state) => {
		if (state !== 'on') return;
		off();
		setTimeout(() => {
			engine.setPaused(true);
			setTimeout(() => engine.setPaused(false), 3000);
		}, pause * 1000);
	});
}
