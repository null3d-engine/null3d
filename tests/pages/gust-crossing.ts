// Measures the gust that a page sends on a path where the readers work the air out of the steady
// field, which is Creek's WebGL2 path. The sketch samples that field along a line across the ground,
// one second and two seconds after the gust, and reports the air that the sent gust adds at each
// sample. This page takes the mean place of that share in each read, so a share that moves along the
// heading is the sent gust crossing the ground. Open it with ?gpu=webgl2 for the path that the
// clause names.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

/** The sketch's answer: two reads of the air that the sent gust adds, and the settings it ran with. */
interface GustReply {
	readonly reads?: readonly {
		readonly at: number;
		readonly step: string;
		readonly speeds: readonly number[];
	}[];
	readonly sent?: readonly number[];
	readonly base?: readonly number[];
	readonly gust?: readonly number[];
	readonly error?: string;
}

/**
 * The shift that best aligns the second read's share with the first's, in samples: each candidate
 * shift moves one profile over the other, and the shift with the least error is how far the gust
 * travelled. The share is what a sent gust adds, so the base wind and the swirl cancel.
 */
function shiftBetween(
	first: readonly number[],
	second: readonly number[],
): { shift: number; error: number } {
	let best = 0;
	let least = Number.POSITIVE_INFINITY;
	for (let shift = -20; shift <= 20; shift++) {
		let error = 0;
		let count = 0;
		for (let i = 0; i < first.length; i++) {
			const j = i + shift;
			if (j < 0 || j >= second.length) continue;
			const difference = (second[j] as number) - (first[i] as number);
			error += difference * difference;
			count++;
		}
		if (count === 0) continue;
		error /= count;
		if (error < least) {
			least = error;
			best = shift;
		}
	}
	return { shift: best, error: least };
}

run('gust-crossing', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/gust-crossing-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	progress('the first frame drew');
	const reply = await new Promise<GustReply>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('the gust was not read in 20 s')), 20_000);
		engine.onSketchMessage((name: string, data: unknown) => {
			if (name !== 'gust') return;
			clearTimeout(timer);
			resolve(data as GustReply);
		});
	});
	if (reply.error) throw new Error(reply.error);
	const reads = reply.reads ?? [];
	if (reads.length !== 2) throw new Error(`the sketch read ${reads.length} times, not two`);
	const [one, two] = reads as unknown as [
		{ at: number; speeds: readonly number[] },
		{ at: number; speeds: readonly number[] },
	];
	const aligned = shiftBetween(one.speeds, two.speeds);
	const sent = reply.sent ?? [0, 0, 0, 0];
	const base = reply.base ?? [0, 0, 0, 0];
	const gust = reply.gust ?? [0, 0, 0, 0];
	const mode = { tier: engine.capabilities.tier, preset: engine.mode.preset };
	await engine.destroy();
	// The samples stand a meter apart, so the samples between the two centroids are the travel in
	// meters. The sent gust travels along the heading at the field's own gust speed.
	const seconds = two.at - one.at;
	const expected = (gust[3] as number) * seconds;
	const travel = aligned.shift;
	return {
		...mode,
		heading: base[1],
		sentStrength: sent[2],
		sentBorn: Number((sent[3] as number).toFixed(3)),
		error: Number(aligned.error.toFixed(4)),
		shareAt: Number(
			(
				one.speeds.reduce((sum, value) => sum + Math.abs(value as number), 0) / one.speeds.length
			).toFixed(4),
		),
		travel,
		expected: Number(expected.toFixed(2)),
		seconds: Number(seconds.toFixed(3)),
		moved: Math.abs(travel - expected) <= 2 && aligned.error < 0.05,
		at: reads.map((read) => Number(read.at.toFixed(3))),
	};
});
