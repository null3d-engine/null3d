// The island's harbour and beach props: a sailing yacht, an open fishing boat, three boulders, a
// beach parasol, a sun lounger and a harbour bench. A script builds them in Blender
// (tools/samples/blender/island-props.py), and the asset tool optimizes them, so they load as a
// developer ships models: quantized meshes and KTX2 textures. They live in the sample-assets
// repository, packed into one file.
//
// A form is a node for each material it uses, such as `yacht-hull` or `rock-a-stone`, and the
// boats and boulders carry two lower levels of detail. The scene stands each node as one instance
// batch over its copies, so the harbour's boats and the coast's thousands of stones cost a few draw
// calls and each copy picks its own level. A boat's origin is its waterline, and every other
// form's origin is its ground point, with the front toward +z as the code-built kit forms have it.
import type { InstanceBatch, Material, SketchContext } from '@null3d/engine';
import { type Part, partsOf, placed, type Stand } from '../../lib/blender-models';
import { sampleUrl } from '../../lib/samples';

/** The parts that each form's file may hold, as `island-props.py` builds them. */
export const PROP_FORMS = {
	yacht: ['hull', 'deck', 'cabin', 'glass', 'rig', 'sail'],
	skiff: ['hull', 'wood', 'engine'],
	'rock-a': ['stone'],
	'rock-b': ['stone'],
	'rock-c': ['stone'],
	parasol: ['canvas', 'pole'],
	lounger: ['frame', 'fabric'],
	bench: ['timber', 'iron'],
} as const;

/** Every form that the file carries. */
export type PropForm = keyof typeof PROP_FORMS;

/** A part name that some form builds. */
export type PropPartName = (typeof PROP_FORMS)[PropForm][number];

/** The forms with two lower levels of detail. The small props need none. */
export const LEVELED_FORMS: readonly PropForm[] = ['yacht', 'skiff', 'rock-a', 'rock-b', 'rock-c'];

/** The boulder forms, in the file's order. */
export const ROCK_FORMS = ['rock-a', 'rock-b', 'rock-c'] as const;

/** The one file that holds every prop. */
export const PROPS_MODEL = sampleUrl('sources/showcase/island-props/props.glb');

/** The two loungers beside each parasol, in its own frame, as the code-built parasol places them. */
export const LOUNGER_OFFSETS = [
	{ x: -0.9, z: -1 },
	{ x: -0.9, z: 0.45 },
] as const;

/** One form's parts, as the file carries them. A lower level of a distant form may leave one out. */
export interface PropModel {
	readonly form: PropForm;
	readonly parts: Readonly<Partial<Record<PropPartName, Part>>>;
}

/** Every prop form, absent until its file lands. */
export interface Props {
	readonly yacht: PropModel | undefined;
	readonly skiff: PropModel | undefined;
	readonly rocks: readonly PropModel[];
	readonly parasol: PropModel | undefined;
	readonly lounger: PropModel | undefined;
	readonly bench: PropModel | undefined;
}

/** One form's parts, or undefined when a part that its form cannot stand without is missing. */
function readModel(
	part: (name: string) => Part,
	form: PropForm,
	required: readonly PropPartName[],
): PropModel | undefined {
	const parts: Partial<Record<PropPartName, Part>> = {};
	for (const name of PROP_FORMS[form]) {
		try {
			parts[name] = part(`${form}-${name}`);
		} catch {
			if (required.includes(name)) return undefined;
		}
	}
	return { form, parts };
}

/** Loads every prop form from the file. */
export async function loadProps({ assets }: SketchContext): Promise<Props> {
	const part = partsOf(await assets.loadGltf(PROPS_MODEL));
	const rocks = ROCK_FORMS.flatMap((form) => {
		const model = readModel(part, form, ['stone']);
		return model ? [model] : [];
	});
	return {
		yacht: readModel(part, 'yacht', ['hull']),
		skiff: readModel(part, 'skiff', ['hull']),
		rocks,
		parasol: readModel(part, 'parasol', ['canvas', 'pole']),
		lounger: readModel(part, 'lounger', ['frame', 'fabric']),
		bench: readModel(part, 'bench', ['timber', 'iron']),
	};
}

/** Where one copy of a prop stands: its foot or waterline, its turn and its size, and its tint. */
export interface PropStand extends Stand {
	/** A scale for each axis, for a copy that is flattened or stretched its own way. */
	readonly scale?: readonly [number, number, number];
	/** The row's tint, which multiplies its material. It needs the options' `colors`. */
	readonly color?: readonly number[];
}

/** How a prop's copies draw. */
export interface PropOptions {
	/**
	 * The material that every copy draws with, in place of the part's own, or a maker that builds
	 * one from the part, for a material that samples the part's own maps.
	 */
	readonly material?: Material | ((part: Part) => Material);
	/** Adds a tint per copy. */
	readonly colors?: boolean;
	/**
	 * A factor on each axis that multiplies every copy's row scale, for a form that must stand at
	 * the size of the code-built form it replaces rather than the size of its file. It leaves the
	 * copy's place alone, and so its seat on the ground.
	 */
	readonly fit?: readonly [number, number, number];
	/**
	 * How far a copy stands below its row, in meters at a scale of 1, for a form whose origin is
	 * its base that takes a code-built form's place: a stone stands at the ground, while the
	 * code-built stone's origin lay above it.
	 */
	readonly drop?: number;
	/** False stops the copies casting shadows, as the boats and the stones do through clear water. */
	readonly castShadows?: boolean;
	readonly receiveShadows?: boolean;
	/** The layers every copy is on, as a 32-bit mask. The default, 1, is layer 0. */
	readonly layers?: number;
}

/**
 * The two loungers of each parasol spot, turned with the spot. A height gives the surface under
 * each lounger, so a lounger on a slope stands on its own ground rather than at the parasol's.
 */
export function loungerStands(
	spots: readonly {
		readonly x: number;
		readonly y: number;
		readonly z: number;
		readonly yaw: number;
	}[],
	height?: (x: number, z: number) => number,
): Stand[] {
	const stands: Stand[] = [];
	for (const spot of spots)
		for (const offset of LOUNGER_OFFSETS) {
			const [c, s] = [Math.cos(spot.yaw), Math.sin(spot.yaw)];
			const x = spot.x + offset.x * c + offset.z * s;
			const z = spot.z - offset.x * s + offset.z * c;
			stands.push({ x, y: height ? height(x, z) : spot.y, z, yaw: spot.yaw, size: 1 });
		}
	return stands;
}

/** Stands one part over its copies, each at its own place, turn, size and tint. */
export function standProp(
	{ scene }: SketchContext,
	part: Part,
	stands: readonly PropStand[],
	options: PropOptions = {},
): InstanceBatch {
	const material =
		typeof options.material === 'function' ? options.material(part) : options.material;
	const [fx, fy, fz] = options.fit ?? [1, 1, 1];
	const batch = scene.createInstances(part.mesh, stands.length, {
		material: material ?? part.material,
		...(options.colors ? { colors: true } : {}),
		castShadows: options.castShadows ?? false,
		receiveShadows: options.receiveShadows ?? true,
		...(options.layers === undefined ? {} : { layers: options.layers }),
	});
	stands.forEach((stand, row) => {
		const drop = (options.drop ?? 0) * (stand.scale?.[1] ?? stand.size);
		const { position, rotation, scale } = placed(
			part,
			[stand.x, stand.y - drop, stand.z],
			stand.yaw,
			stand.size,
		);
		batch.positions.set(position, row * 3);
		batch.rotations.set(rotation, row * 4);
		if (stand.scale)
			batch.scales.set(
				[
					part.scale[0] * stand.scale[0] * fx,
					part.scale[1] * stand.scale[1] * fy,
					part.scale[2] * stand.scale[2] * fz,
				],
				row * 3,
			);
		else batch.scales.set([scale[0] * fx, scale[1] * fy, scale[2] * fz], row * 3);
		if (options.colors && stand.color) batch.colors?.set(stand.color, row * 4);
	});
	batch.markDirty();
	return batch;
}

/** How a whole form stands. */
export interface ModelOptions extends PropOptions {
	/** The parts to stand. The default is every part that the file carries. */
	readonly parts?: readonly PropPartName[];
	/** The parts whose copies take a tint from their stands. */
	readonly tint?: readonly PropPartName[];
	/**
	 * A factor on each axis for each form, which brings that form to the size of the code-built
	 * form it replaces. A form that the table leaves out takes the size of its file.
	 */
	readonly fits?: Readonly<Partial<Record<PropForm, readonly [number, number, number]>>>;
}

/**
 * Stands each part of a form over the same copies, and returns their batches. A part that fails
 * takes back the batches already made, so a form never half stands.
 */
export function standModel(
	ctx: SketchContext,
	model: PropModel,
	stands: readonly PropStand[],
	options: ModelOptions = {},
): InstanceBatch[] {
	const made: InstanceBatch[] = [];
	if (stands.length === 0) return made;
	const fit = options.fits?.[model.form];
	try {
		for (const name of options.parts ?? PROP_FORMS[model.form]) {
			const part = model.parts[name];
			if (!part) continue;
			made.push(
				standProp(ctx, part, stands, {
					...options,
					colors: (options.tint ?? []).includes(name),
					...(fit && { fit }),
				}),
			);
		}
		return made;
	} catch (error) {
		for (const batch of made) batch.destroy();
		throw error;
	}
}

/** A batch's row arrays, which `standsOf` reads and a real `InstanceBatch` provides. */
export interface PropSource {
	readonly count: number;
	readonly positions: Float32Array;
	readonly rotations: Float32Array;
	readonly scales: Float32Array;
	readonly colors: Float32Array | undefined;
}

/**
 * A batch's rows as stands, so a model takes the batch's place at the same places, turns, scales
 * and tints. A copy's turn is about y, as the scene places every copy.
 */
export function standsOf(source: PropSource): PropStand[] {
	const stands: PropStand[] = [];
	for (let row = 0; row < source.count; row++) {
		const at = row * 3;
		const quaternion = row * 4;
		const yaw =
			2 * Math.atan2(source.rotations[quaternion + 1] ?? 0, source.rotations[quaternion + 3] ?? 0);
		const color = source.colors
			? ([
					source.colors[quaternion] ?? 1,
					source.colors[quaternion + 1] ?? 1,
					source.colors[quaternion + 2] ?? 1,
					source.colors[quaternion + 3] ?? 1,
				] as const)
			: undefined;
		stands.push({
			x: source.positions[at] ?? 0,
			y: source.positions[at + 1] ?? 0,
			z: source.positions[at + 2] ?? 0,
			yaw,
			size: 1,
			scale: [source.scales[at] ?? 1, source.scales[at + 1] ?? 1, source.scales[at + 2] ?? 1],
			...(color ? { color } : {}),
		});
	}
	return stands;
}

/** One model that takes a code-built batch's place, and where its copies stand. */
export interface ModelStanding {
	readonly model: PropModel;
	/** The rows to stand it over. The default is the code-built batch's own rows. */
	readonly stands?: readonly PropStand[];
	readonly options?: ModelOptions;
}

/**
 * Stands models over the copies of one code-built batch, at the batch's own rows, and then removes
 * the batch. A model that cannot stand leaves the code-built batch in place, so no form disappears.
 */
function replaceRows(
	ctx: SketchContext,
	kit: InstanceBatch,
	rows: readonly PropStand[],
	standings: readonly ModelStanding[],
): InstanceBatch[] {
	const made: InstanceBatch[] = [];
	try {
		for (const { model, stands, options } of standings)
			made.push(...standModel(ctx, model, stands ?? rows, options));
	} catch (error) {
		for (const batch of made) batch.destroy();
		throw error;
	}
	kit.destroy();
	return made;
}

/** Stands models over a code-built batch's own rows, and then removes the batch. */
export function replaceBatch(
	ctx: SketchContext,
	kit: InstanceBatch,
	standings: readonly ModelStanding[],
): InstanceBatch[] {
	return replaceRows(ctx, kit, standsOf(kit), standings);
}

/**
 * Stands several forms over the rows of one code-built batch in turn, and then removes the batch.
 * The breakwater's stones and the coast's rocks share a batch this way, each form taking a share
 * of the rows.
 */
export function replaceWithForms(
	ctx: SketchContext,
	models: readonly PropModel[],
	kit: InstanceBatch,
	options: ModelOptions = {},
): InstanceBatch[] {
	if (models.length === 0) return [];
	const rows = standsOf(kit);
	const shares: PropStand[][] = models.map(() => []);
	rows.forEach((stand, row) => {
		shares[row % models.length]?.push(stand);
	});
	return replaceRows(
		ctx,
		kit,
		rows,
		models.map((model, k) => ({ model, stands: shares[k] ?? [], options })),
	);
}
