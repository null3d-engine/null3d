// Starts the engine in hold mode with a mesh made in code whose level plan waits behind busy job
// workers (sketches/levels-held-sketch.ts). It reports the levels that the held frames' grid held,
// and the levels that the plan gave with whether they came before the hold ended.
import { createEngine, type HoldResult } from '@null3d/engine';
import { progress, run } from './lib/result';

run('levels-held', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const held: number[] = [];
	/** The levels that the grid's plan gave, and whether they came before the hold ended. */
	let planned: { levels: number; beforeHold: boolean } | undefined;
	let holdEnded = false;
	const started = performance.now();
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/levels-held-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		hold: 0.5,
		onSketchMessage: (name, data) => {
			if (name === 'held-levels') held.push(data as number);
			if (name === 'planned-levels') planned = { levels: data as number, beforeHold: !holdEnded };
		},
	});
	holdEnded = true;
	progress('the held frame');
	const result = (globalThis as { __null3dHold?: HoldResult }).__null3dHold;
	if (result === undefined) throw new Error('the engine published no held frame');
	if (!result.ok) throw new Error(`hold mode failed: ${result.error}`);
	const seconds = Math.round((performance.now() - started) / 100) / 10;
	// The held frames' messages may come a moment after the held frame.
	await new Promise((resolve) => setTimeout(resolve, 500));
	await engine.destroy();
	return { tier: engine.capabilities.tier, held, planned, seconds };
});
