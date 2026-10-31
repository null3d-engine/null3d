// The spring of a branch pose, run live: the sketch stops the air a second in and reads one branch's
// turn from the pose pass until it has settled. The page posts the series, which
// `tests/image/poses-spring.spec.ts` judges.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

run('poses-spring', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/poses-spring-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		preset: 'high',
	});
	await engine.firstFrame;
	progress('the first frame drew');
	const result = await new Promise<Record<string, unknown>>((resolve) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'spring') resolve(data as Record<string, unknown>);
		});
	});
	await engine.destroy();
	return result;
});
