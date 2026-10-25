// A page that records its own session on a real device, for the runner page to read: it drives the
// keyboard and a touch through the page's own events, holds one frame long enough to be a hitch,
// saves the recording, and publishes the session's frame lines with the file. A test on the
// computer replays the file and compares the lines with the session's, so a recording from a phone
// must give the same frames here.
import { createEngine, type Engine } from '@null3d/engine';
import { run } from './lib/result';

/** What each frame gave the sketch, as the sketch posts it. */
const log: string[] = [];

const canvas = document.querySelector('canvas');
if (canvas === null) throw new Error('the page has no canvas');

/** Resolves after `ms` milliseconds. */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Blocks the page's thread for `ms` milliseconds, so the frame around it is long. */
function hold(ms: number): void {
	const until = performance.now() + ms;
	while (performance.now() < until) {
		// The frame after this one is the session's hitch.
	}
}

/** Sends a key's press or release, as the page's own events reach the engine. */
function key(type: 'keydown' | 'keyup'): void {
	window.dispatchEvent(
		new KeyboardEvent(type, { code: 'KeyW', key: 'w', bubbles: true, cancelable: true }),
	);
}

/** Sends a touch at a place on the canvas: its move, press or release. */
function touch(type: 'pointermove' | 'pointerdown' | 'pointerup', x: number, y: number): void {
	const rect = (canvas as HTMLCanvasElement).getBoundingClientRect();
	const buttons = type === 'pointerup' ? 0 : type === 'pointerdown' ? 1 : 0;
	canvas?.dispatchEvent(
		new PointerEvent(type, {
			pointerId: 1,
			pointerType: 'touch',
			isPrimary: true,
			clientX: rect.left + x,
			clientY: rect.top + y,
			buttons,
			bubbles: true,
			cancelable: true,
		}),
	);
}

/** The bytes as base64, in chunks so a long session does not overflow a spread. */
function base64(bytes: Uint8Array): string {
	let text = '';
	const chunk = 0x8000;
	for (let at = 0; at < bytes.length; at += chunk)
		text += String.fromCharCode(...bytes.subarray(at, at + chunk));
	return btoa(text);
}

/** The longest step in the frame lines, in seconds: the session's hitch, when it had one. */
function longestStep(lines: readonly string[]): number {
	let last = 0;
	let longest = 0;
	for (const line of lines) {
		const now = Number(line.split('|')[1]);
		longest = Math.max(longest, now - last);
		last = now;
	}
	return longest;
}

run('record', async () => {
	const engine: Engine = await createEngine({
		canvas: canvas as HTMLCanvasElement,
		sketch: new URL('./sketches/recording-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		onSketchMessage: (name, data) => {
			if (name === 'frame' && typeof data === 'string') log.push(data);
		},
	});
	await wait(250);
	key('keydown');
	touch('pointermove', 120, 90);
	touch('pointerdown', 120, 90);
	// A frame this long is a hitch that the recording must keep, so the replay spans one too.
	hold(250);
	await wait(400);
	touch('pointerup', 120, 90);
	key('keyup');
	await wait(250);
	const bytes = (await engine.saveRecording()) ?? new Uint8Array(0);
	if (bytes.length === 0) throw new Error('the page recorded nothing');
	const frames = log.length;
	if (!log.some((line) => line.split('|')[3] === '1'))
		throw new Error('the session never recorded the key as down');
	if (longestStep(log) < 0.2) throw new Error('the session held no long frame to replay');
	return {
		log: log.slice(),
		frames,
		longestStep: longestStep(log),
		recording: base64(bytes),
	};
});
