// The Island with its camera held at one pose, and every object labelled by the part of the scene
// that made it, so the page can hide one part at a time and time the frame without it. The labels
// come from each object's material, and, for the plain materials, from the step of the Island's
// setup that made them: the ground, then the sea, then the town, then the trees. A hidden part keeps
// its objects; a mesh stops drawing and a batch draws no rows, and showing it again restores what
// the Island last asked of each. Research code: it changes nothing in the Island itself.
import type { SketchContext } from '@null3d/engine';
import { defineSketch } from '@null3d/engine';
import island from '../../../../examples/showcase/island/sketch';

/** The parts that the page can hide. */
export const GROUPS = [
	'ground',
	'seabed',
	'foam',
	'water',
	'reflection',
	'town',
	'trees',
	'shrubs',
	'cypress',
	'cards',
	'casters',
	'grass',
	'shadows',
	'other',
] as const;
type Group = (typeof GROUPS)[number];

const params = new URL(import.meta.url).searchParams;
const pose = (params.get('pose') ?? '-92,36,360,-92,26,200').split(',').map(Number);

/** One object that a part holds: how to draw it as the Island wants, or not at all. */
interface Held {
	apply(): void;
	rows(): number;
}

export default defineSketch(async (ctx: SketchContext) => {
	const held = new Map<Group, Set<Held>>(GROUPS.map((g) => [g, new Set()]));
	const hidden = new Set<Group>();
	const kinds = new WeakMap<object, Group>();
	// The step of the setup that is running: it labels the plain materials and the objects made with them.
	let phase: Group = 'other';
	let waterMaterial: object | undefined;

	// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
	const anyCtx = ctx as any;
	const scene = anyCtx.scene;
	const materials = anyCtx.materials;

	const camera = scene.createPerspectiveCamera.bind(scene);
	scene.createPerspectiveCamera = (options: unknown) => {
		const made = camera(options);
		const setPosition = made.setPosition.bind(made);
		const lookAt = made.lookAt.bind(made);
		made.setPosition = () => setPosition(pose[0], pose[1], pose[2]);
		made.lookAt = () => lookAt(pose[3], pose[4], pose[5]);
		return made;
	};

	let sun:
		| { setCastShadows(on: boolean): void; setShadow(options: { distance: number }): void }
		| undefined;
	let shadowDistance = 0;
	// The card materials with the atlas values that they started with, so a trial can draw them from one view.
	const cardCells = new Map<{ setUniform(name: string, value: number[]): void }, number[]>();
	// The grass batches with the draw range that the Island gave them.
	const grassRanges = new Map<{ setDrawRange(a: number, b: number): void }, [number, number]>();
	// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
	const grassBatches: any[] = [];
	const directional = scene.createDirectionalLight.bind(scene);
	scene.createDirectionalLight = (options: unknown) => {
		const made = directional(options);
		if (!sun) {
			sun = made;
			// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
			shadowDistance = (options as any)?.shadow?.distance ?? 0;
		}
		return made;
	};

	// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
	const label = (options: any): Group => {
		const textures = options?.textures ?? {};
		if (textures.splatMap) return 'ground';
		if (textures.mirror) return 'water';
		if (textures.impostorColor) return 'cards';
		if (textures.leafColor) return 'trees';
		if (options?.uniforms?.sway !== undefined && options?.uniforms?.cull !== undefined)
			return 'grass';
		if (phase === 'trees') return 'cypress';
		return phase;
	};
	// The material calls live on the object's prototype, so the names come from both.
	const names = new Set([
		...Object.keys(materials),
		...Object.getOwnPropertyNames(Object.getPrototypeOf(materials)),
	]);
	names.delete('constructor');
	for (const name of names) {
		const make = materials[name];
		if (typeof make !== 'function') continue;
		const bound = make.bind(materials);
		// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
		materials[name] = (options: any, ...rest: unknown[]) => {
			const made = bound(options, ...rest);
			if (!made || typeof made !== 'object' || kinds.has(made)) return made;
			const kind = label(options);
			kinds.set(made, kind);
			if (kind === 'cards' && Array.isArray(options?.uniforms?.cells))
				cardCells.set(made, [...options.uniforms.cells]);
			if (kind === 'ground' && phase === 'other') phase = 'seabed';
			if (kind === 'water') waterMaterial = made;
			return made;
		};
	}

	// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
	const groupOf = (options: any, castShadows: boolean | undefined): Group => {
		let kind = (options?.material && kinds.get(options.material)) ?? phase;
		// The plants' shrubs cast and the trees' meshes do not, by the Island's own choice.
		if (kind === 'trees' && castShadows === true) kind = 'shrubs';
		// The sea's foam lies on its own layer, which the mirror leaves out.
		if (kind === 'seabed' && options?.alphaMode === 'blend') kind = 'foam';
		if (kind === 'seabed' && options?.material?.alphaMode === 'blend') kind = 'foam';
		return kind;
	};

	const meshes = scene.createMesh.bind(scene);
	// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
	scene.createMesh = (options: any) => {
		const object = meshes(options);
		let group = groupOf(options, options?.castShadows);
		if (group === 'seabed' && options?.layers !== undefined && options.layers !== 1) group = 'foam';
		const set = object.setVisible.bind(object);
		const destroy = object.destroy.bind(object);
		let wants = true;
		const entry: Held = {
			apply: () => set(wants && !hidden.has(group)),
			rows: () => (wants ? 1 : 0),
		};
		object.setVisible = (visible: boolean) => {
			wants = visible;
			entry.apply();
		};
		object.destroy = () => {
			held.get(group)?.delete(entry);
			destroy();
		};
		held.get(group)?.add(entry);
		if (hidden.has(group)) entry.apply();
		if (options?.material && options.material === waterMaterial) phase = 'town';
		return object;
	};

	const instances = scene.createInstances.bind(scene);
	// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
	scene.createInstances = (mesh: any, count: number, options: any) => {
		const batch = instances(mesh, count, options);
		let group = groupOf(options, options?.castShadows);
		// The cards that only the sun sees cast every tree's shadow.
		if (group === 'cards' && options?.layers !== undefined && options.layers !== 1)
			group = 'casters';
		if (group === 'grass') {
			grassBatches.push(batch);
			const range = batch.setDrawRange.bind(batch);
			grassRanges.set({ setDrawRange: range }, [0, Number.POSITIVE_INFINITY]);
			batch.setDrawRange = (start: number, end: number) => {
				for (const key of grassRanges.keys())
					if (key.setDrawRange === range) grassRanges.set(key, [start, end]);
				range(start, end);
			};
		}
		const set = batch.setActiveCount.bind(batch);
		const destroy = batch.destroy.bind(batch);
		let wants = count;
		const entry: Held = {
			apply: () => set(hidden.has(group) ? 0 : wants),
			rows: () => wants,
		};
		batch.setActiveCount = (active: number) => {
			wants = active;
			entry.apply();
		};
		batch.destroy = () => {
			held.get(group)?.delete(entry);
			destroy();
		};
		held.get(group)?.add(entry);
		if (hidden.has(group)) entry.apply();
		return batch;
	};

	const reflections: unknown[] = [];
	const render = anyCtx.render;
	const addPass = render.addPass.bind(render);
	// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
	render.addPass = (options: any) => {
		const pass = addPass(options);
		if (options?.kind === 'reflection') reflections.push(pass);
		return pass;
	};

	const post = ctx.page.post.bind(ctx.page);
	// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
	(ctx.page as any).post = (name: string, data?: unknown) => {
		if (name === 'loading' && data === 'Growing the trees') phase = 'trees';
		return post(name, data);
	};

	const show = (group: Group, on: boolean) => {
		if (on) hidden.delete(group);
		else hidden.add(group);
		if (group === 'reflection') for (const pass of reflections) render.setPassEnabled(pass, on);
		else if (group === 'shadows') sun?.setCastShadows(on);
		else for (const entry of held.get(group) ?? []) entry.apply();
	};

	/**
	 * A trial change, applied for one window and undone after it: the far cards drawn from their
	 * nearest atlas view alone, the sun's shadows over a shorter reach, the grass over a shorter reach
	 * or casting no shadow, a coarser threshold of the levels of detail, and the water's reflection
	 * drawn once in a given number of frames.
	 */
	const trial = (name: string, on: boolean) => {
		if (name === 'cards1')
			for (const [material, cells] of cardCells)
				material.setUniform('cells', on ? [cells[0], cells[1], 1, cells[3]] : cells);
		else if (name.startsWith('shadow'))
			sun?.setShadow({ distance: on ? Number(name.slice(6)) : shadowDistance });
		else if (name.startsWith('grass'))
			for (const [batch, [start, end]] of grassRanges)
				batch.setDrawRange(start, on ? Math.min(end, Number(name.slice(5))) : end);
		else if (name.startsWith('lod'))
			ctx.quality.set({
				lodThreshold: on ? Number(name.slice(3)) : ctx.quality.preset === 'low' ? 2 : 1,
			});
		else if (name === 'grassdark') for (const batch of grassBatches) batch.setCastShadows(!on);
		else if (name.startsWith('reflect'))
			for (const pass of reflections)
				render.setPassEvery(
					pass,
					on ? Number(name.slice(7)) : ['high', 'ultra'].includes(ctx.quality.preset) ? 1 : 2,
				);
	};

	let pending: { name: string; frames: number; value: () => unknown } | undefined;
	ctx.page.onMessage((name, data) => {
		if (name === 'try') {
			const { trial: which, on } = data as { trial: string; on: boolean };
			trial(which, on);
			pending = { name: 'tried', frames: 4, value: () => which };
		}
		if (name === 'hide') {
			const wanted = new Set(data as Group[]);
			for (const group of GROUPS) show(group, !wanted.has(group));
			pending = { name: 'hidden', frames: 4, value: () => [...hidden] };
		}
		if (name === 'set') {
			ctx.quality.set(data as never);
			pending = { name: 'settled', frames: 4, value: () => true };
		}
		if (name === 'census')
			pending = {
				name: 'censused',
				frames: 1,
				value: () => ({
					viewport: { ...ctx.engine.viewport },
					preset: ctx.quality.preset,
					groups: Object.fromEntries(
						[...held].map(([g, set]) => [
							g,
							{ objects: set.size, rows: [...set].reduce((s, e) => s + e.rows(), 0) },
						]),
					),
					reflections: reflections.length,
				}),
			};
	});

	// A production build counts the triangles of the GPU-culled draws only while the sketch asks for them.
	ctx.debug.frameStats();
	const callbacks = await island.setup(ctx);
	// The render scale holds still unless the page asks for the governor, as a visitor's page runs.
	if (params.get('governor') !== 'on') {
		const scale = Number(params.get('scale') ?? 1);
		ctx.quality.set({ minRenderScale: scale, maxRenderScale: scale, governor: false });
	}
	return {
		...callbacks,
		onUpdate(...args: unknown[]) {
			// biome-ignore lint/suspicious/noExplicitAny: research code reaches past the public types
			(callbacks as any)?.onUpdate?.(...args);
			if (pending && --pending.frames <= 0) {
				const { name, value } = pending;
				pending = undefined;
				ctx.page.post(name, value());
			}
		},
	};
}, island.options);
