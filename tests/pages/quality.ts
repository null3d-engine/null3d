// Starts the engine with a sketch that reports its quality preset and settings, and reports them
// with the engine's mode, its GPU path, the device hints of its capability report, and the crash
// notes in localStorage once the first frame is on screen. ?option= passes createEngine's preset
// option, and ?antialias= its anti-aliasing option. ?budget= has the sketch set its own texture
// upload budget in bytes first. ?set= sends the sketch settings to change, as JSON, and reports
// the change it hears of, or the error that refused it. ?wait=<ms> waits that long after the first
// frame and reports the notes again.
import { createEngine, type EngineOptions, type QualityPreset } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
/** How long the page waits for the sketch's answer to a change. */
const ANSWER_MS = 2_000;

/** The keys of the engine's crash notes in localStorage, or null where storage throws. */
function crashNotes(): string[] | null {
	try {
		return Object.keys(localStorage).filter((key) => key.startsWith('null3d.start:'));
	} catch {
		return null;
	}
}

run('quality', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const messages = new Map<string, unknown>();
	const waiters = new Map<string, (data: unknown) => void>();
	/** Resolves with the sketch's message `name`, or with undefined when none comes in time. */
	const message = (name: string, timeoutMs = ANSWER_MS) =>
		new Promise<unknown>((resolve) => {
			if (messages.has(name)) resolve(messages.get(name));
			waiters.set(name, resolve);
			setTimeout(() => resolve(undefined), timeoutMs);
		});
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/quality-sketch.ts', import.meta.url),
		preset: (params.get('option') ?? undefined) as QualityPreset | undefined,
		antialias: (params.get('antialias') ?? undefined) as EngineOptions['antialias'],
		onSketchMessage: (name, data) => {
			messages.set(name, data);
			waiters.get(name)?.(data);
		},
	});
	await engine.firstFrame;
	const notesAtFirstFrame = crashNotes();
	const sketch = await message('quality');
	let changed: unknown;
	let refused: unknown;
	const budget = params.get('budget');
	if (budget !== null) engine.postToSketch('budget', Number(budget));
	const set = params.get('set');
	if (set !== null) {
		engine.postToSketch('set', JSON.parse(set));
		[changed, refused] = await Promise.all([message('changed'), message('refused')]);
	}
	const wait = Number(params.get('wait') ?? 0);
	if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
	const { coarsePointer, screenMinEdge, deviceMemoryGB } = engine.report;
	return {
		mode: engine.mode,
		tier: engine.capabilities.tier,
		hints: { coarsePointer, screenMinEdge, deviceMemoryGB },
		sketch,
		changed,
		refused,
		notesAtFirstFrame,
		notesAfterWait: wait > 0 ? crashNotes() : undefined,
	};
});
