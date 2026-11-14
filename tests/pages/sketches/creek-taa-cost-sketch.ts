// The Creek showcase with the temporal resolve's switch, for measuring the resolve's cost in a
// scene that draws every pass it can. The showcase loads at run time, so the test pages' program
// does not take the demo's own types and compiler options. The cost page runs on the dev server,
// which transforms the module that the address names.
import { defineSketch, type SketchCallbacks, type SketchContext } from '@null3d/engine';

/** The shape of the showcase's default export. */
interface Showcase {
	default: {
		setup: (
			context: SketchContext,
		) => SketchCallbacks | undefined | Promise<SketchCallbacks | undefined>;
	};
}

const params = new URL(import.meta.url).searchParams;
/** True picks the resolve's cheaper phone path. */
const PHONE = params.get('phone') === '1';

export default defineSketch(async (context) => {
	const address = new URL('../../../examples/showcase/creek/sketch.ts', import.meta.url).href;
	const creek = (await import(/* @vite-ignore */ address)) as Showcase;
	const callbacks = await creek.default.setup(context);
	const set = (on: boolean) =>
		context.post.set({ taa: on ? { feedback: 0.9, jitter: true, phone: PHONE } : false });
	context.page.onMessage((name) => {
		if (name !== 'taa' && name !== 'taa-off') return;
		set(name === 'taa');
		void context.scene.warmUp().then(() => context.page.post('settled', {}));
	});
	return callbacks;
});
