// Times the sound add-on's mixer on this machine, as the record of its design states it (D-384): four
// loops and a group of 200 emitters with 28 voices, 32 voices in all, with every emitter moving every
// sixth quantum. It renders ten seconds of audio at 48 kHz five times, after a warm-up second, and
// prints the work for each second of audio. The browser runs the mixer on its audio thread, in its
// own JavaScript engine, so the figure gives the scale of the cost rather than a browser's own.
//   bun --conditions=null3d-source tools/sound-mixer-cost.ts
import {
	MAX_VOICES,
	MIXER_OUTPUTS,
	OUTPUT_COUNT,
	tableLayout,
} from '../packages/sound/src/layout.ts';
import { Mixer } from '../packages/sound/src/mixer-worklet.ts';
import type { SoundSpec } from '../packages/sound/src/protocol.ts';

const RATE = 48_000;
const FRAMES = 128;
const CAPACITY = 256;
const LOOPS = 4;
const MEMBERS = 200;
const RUNS = 5;
const SECONDS = 10;

const layout = tableLayout(CAPACITY);
const buffer = new SharedArrayBuffer(layout.length * 4);
const floats = new Float32Array(buffer);
const ints = new Int32Array(buffer);
floats[layout.volume] = 1;
// The listener turns a little, so the mixer's turn into its frame does real work.
floats[layout.listenerTurn + 1] = 0.2;
floats[layout.listenerTurn + 3] = Math.sqrt(1 - 0.04);
for (let e = 0; e < CAPACITY; e++) {
	floats[layout.levels + e] = 1;
	floats[layout.rates + e] = 1;
	floats[layout.tones + e] = 1;
}
const mixer = new Mixer(RATE, { outputs: MIXER_OUTPUTS, voices: MAX_VOICES }, () => {});
mixer.receive({ type: 'table', layout, buffer });
const base = { file: 'cost', positional: true, near: 2, far: 200, muffle: true } as const;
for (let i = 0; i < LOOPS; i++) {
	const sound: SoundSpec = {
		...base,
		id: i + 1,
		kind: 'loop',
		first: i,
		count: 1,
		voice: i,
		voices: 1,
	};
	mixer.receive({ type: 'add', sound });
}
mixer.receive({
	type: 'add',
	sound: {
		...base,
		id: LOOPS + 1,
		kind: 'group',
		first: LOOPS,
		count: MEMBERS,
		voice: LOOPS,
		voices: MAX_VOICES - LOOPS,
	},
});
for (let v = 0; v < MAX_VOICES; v++) mixer.receive({ type: 'ready', voice: v });
const outputs = Array.from({ length: OUTPUT_COUNT }, () =>
	Array.from({ length: MAX_VOICES }, () => new Float32Array(FRAMES)),
);
const quantaPerSecond = RATE / FRAMES;
let time = 0;
const step = () => {
	time += FRAMES / RATE;
	ints[layout.frame] = ((ints[layout.frame] as number) + 1) | 0;
	if ((ints[layout.frame] as number) % 6 === 0)
		for (let e = 0; e < LOOPS + MEMBERS; e++) {
			floats[layout.places + 3 * e] = Math.sin(time + e) * 80;
			floats[layout.places + 3 * e + 2] = Math.cos(time * 0.7 + e) * 80;
		}
	mixer.render(outputs);
};
for (let q = 0; q < quantaPerSecond; q++) step();
const runs: number[] = [];
for (let r = 0; r < RUNS; r++) {
	const start = performance.now();
	for (let q = 0; q < quantaPerSecond * SECONDS; q++) step();
	runs.push((performance.now() - start) / SECONDS);
}
runs.sort((a, b) => a - b);
console.log(
	`the mixer: ${runs.map((r) => r.toFixed(2)).join(', ')} ms of work per second of audio, median ${(runs[Math.floor(RUNS / 2)] as number).toFixed(2)} ms`,
);
