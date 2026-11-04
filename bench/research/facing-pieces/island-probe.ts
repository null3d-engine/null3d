// Temporary measuring page: the Island at a fixed view, and the triangles and draws that each
// mesh's copies add to a frame, with the sun's shadows on and off. After ?warm= seconds it measures
// the whole frame, then hides each mesh's copies in turn and measures again. ?pose=, ?window=.
// Not kept in the repository.
import { createEngine, type Engine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const pose = (params.get('pose') ?? '-92,36,360,-92,26,200').split(',').map(Number);
const warm = Number(params.get('warm') ?? 60);
const window = Number(params.get('window') ?? 1);
/** Seconds after a change before a window opens, so the draw tables and the counts settle. */
const settle = Number(params.get('settle') ?? 2);
const pause = () => new Promise((r) => setTimeout(r, settle * 1000));

/** Posts a message and waits for the sketch's answer. */
function ask(engine: Engine, name: string, data: unknown, answer: string): Promise<unknown> {
	return new Promise((resolve) => {
		const off = engine.onSketchMessage((got, value) => {
			if (got !== answer) return;
			off();
			resolve(value);
		});
		engine.postToSketch(name, data);
	});
}

/** The frame's mean triangles and draws over a window. */
async function counts(engine: Engine) {
	const m = await engine.measure(window);
	return { triangles: Math.round(m.triangles.median), draws: Math.round(m.drawCalls.median) };
}

run('island-probe', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/island-probe-sketch.ts', import.meta.url),
		preset: 'high',
		momentTransparency: true,
		stats: false,
		maxPixelRatio: 1,
	});
	engine.postToSketch('pose', pose);
	await engine.firstFrame;
	await new Promise((r) => setTimeout(r, warm * 1000));
	const meshes = (await ask(engine, 'list', null, 'groups')) as {
		index: number;
		label: string;
		triangles: number;
		copies: number;
	}[];
	// The meshes that one function made form one group, such as every block of the terrain.
	const byLabel = new Map<
		string,
		{ label: string; indices: number[]; triangles: number; copies: number }
	>();
	for (const mesh of meshes) {
		const group = byLabel.get(mesh.label) ?? {
			label: mesh.label,
			indices: [],
			triangles: 0,
			copies: 0,
		};
		group.indices.push(mesh.index);
		group.triangles += mesh.triangles * mesh.copies;
		group.copies += mesh.copies;
		byLabel.set(mesh.label, group);
	}
	const groups = [...byLabel.values()].map((group, index) => ({ ...group, index }));
	if (params.has('list')) {
		await engine.destroy();
		return { groups };
	}
	const passes: Record<string, unknown> = {};
	for (const shadows of [true, false]) {
		await ask(engine, 'shadows', shadows, 'shadowsn');
		await pause();
		const whole = await counts(engine);
		const each = [];
		for (const g of groups) {
			await ask(engine, 'hide', g.indices, 'hiden');
			await pause();
			const hidden = await counts(engine);
			await ask(engine, 'show', g.indices, 'shown');
			await pause();
			each.push({
				index: g.index,
				triangles: whole.triangles - hidden.triangles,
				draws: whole.draws - hidden.draws,
			});
			progress(`shadows ${shadows} group ${g.index}`);
		}
		passes[shadows ? 'shadows' : 'noShadows'] = { whole, each };
	}
	await engine.destroy();
	return { groups, ...passes };
});
