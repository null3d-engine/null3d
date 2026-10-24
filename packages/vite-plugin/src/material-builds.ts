// Compiled shaders' builds load on first use, as the engine's own shader files do. A custom
// material builds into every variant of the standard material on both GPU paths, and a device
// draws with a few of them: those of its GPU path and of the permutation bits that it fixes, the
// draw index on WebGL2 and tone mapping in the shader on the 8-bit path. A custom effect and a
// custom tone curve build into every variant of their template, and a device draws with those of
// its own path. So the module that holds a shader keeps none of its builds. The plugin puts them in
// virtual modules of its own. A material gets one for each GPU path, each value of those bits and
// the builds that skin in the vertex shader or the others: 4 sets for WebGPU and 8 for WebGL2. An
// effect or a tone curve gets one for each GPU path. Each set holds the builds of every shader of
// its kind in the module, with the text that they share once. A shader's value in the module gets
// a function that imports one set, which the engine calls when the shader is first used: for a
// material the set of its device at once, and the others when a pipeline needs one, such as the
// builds without tone mapping once bloom turns on, or those that skin for the first skinned mesh.
// A build of the project puts each set in a file of its own, which pages of other devices never
// download. Custom shaders build without half precision, so the half bit, which splits the engine's
// own WebGPU modules, does not split these sets.
import { createHash } from 'node:crypto';
import { LOAD_BUILDS, ShaderPack } from './pack.ts';
import type { CompiledWgsl, ShaderVariant } from './shader-types.ts';

/** The pieces of a shader that joins no host, which a module keeps none of. */
const EMPTY_PIECES = { group: {}, fold: {} } as const;

/** The prefix of the virtual modules that hold sets of custom materials' builds. */
export const MATERIAL_BUILDS = 'virtual:null3d/builds/';

/**
 * The name or module id of a virtual module of builds, as Vite's hook filters match them. Its last
 * part names the kind, the GPU path, the set's bits and a hash of its builds, and gives a build's
 * file of the set its name, such as `material-glsl-3-<hash>.js` or `curve-wgsl-0-<hash>.js`.
 */
export const MATERIAL_BUILDS_ADDRESS =
	/^\0?virtual:null3d\/builds\/(?:material|effect|curve)-(?:wgsl|glsl)-\d+-[0-9a-f]+$/;

/** The permutation bit of WebGL2 builds that read the draw index of a multi-draw. */
export const DRAW_INDEX = 1;
/** The permutation bit of builds that tone map in the shader, on the 8-bit path. */
export const TONE_MAP = 2;
/** The permutation bit of builds that skin in the vertex shader. */
export const SKIN = 64;

/** A GPU path, as a build's field of its output names it. */
type Target = 'wgsl' | 'glsl';

/** The permutation bits that a device of each GPU path fixes, which split its builds into sets. */
const FIXED: Readonly<Record<Target, number>> = { wgsl: TONE_MAP, glsl: TONE_MAP | DRAW_INDEX };

/** The builds of one custom material, by name. */
type Builds = Readonly<Record<string, ShaderVariant>>;

/** Each value of the bits of `mask`, from 0 up. */
function valuesOf(mask: number): number[] {
	let values = [0];
	for (let bit = 1; bit <= mask; bit <<= 1)
		if (mask & bit) values = values.flatMap((value) => [value, value | bit]);
	return values;
}

/**
 * The builds of `builds` with output for `target` in the set `set`: those whose skinning bit and
 * fixed bits are the set's. A build without a fixed bit belongs to the set with the bit too, when
 * no twin of it has the bit, such as a shadow caster's build, which never tone maps. Each build
 * keeps only its output for `target`.
 */
export function buildsOfSet(builds: Builds, target: Target, set: number): Builds {
	const fixed = FIXED[target];
	const permutations = new Set<number>();
	for (const build of Object.values(builds))
		if (build[target] !== null) permutations.add(build.permutation);
	const picked: Record<string, ShaderVariant> = {};
	for (const [name, build] of Object.entries(builds)) {
		const output = build[target];
		const p = build.permutation;
		if (output === null || (p & SKIN) !== (set & SKIN)) continue;
		let fits = true;
		for (let bit = 1; bit <= fixed && fits; bit <<= 1)
			if (fixed & bit && (p & bit) !== (set & bit))
				fits = (p & bit) === 0 && !permutations.has(p | bit);
		if (!fits) continue;
		picked[name] = {
			permutation: p,
			wgsl: target === 'wgsl' ? build.wgsl : null,
			glsl: target === 'glsl' ? build.glsl : null,
		};
	}
	return picked;
}

/** The sets of a GPU path: each value of its fixed bits, without and with skinning. */
export function setsOf(target: Target): number[] {
	return valuesOf(FIXED[target] | SKIN).sort((x, y) => x - y);
}

/** The OR of every build's permutation bits, which tells the engine what the material can draw. */
function permutationsOf(builds: Builds): number {
	let bits = 0;
	for (const build of Object.values(builds)) bits |= build.permutation;
	return bits;
}

/** A kind of compiled WGSL whose builds load on first use. */
export type BuildKind = 'material' | 'effect' | 'toneCurve';

/** One shader of a module whose builds load on first use. */
export interface BuildSource {
	/** The shader's kind, which keeps the sets of one kind apart from another's. */
	readonly kind: BuildKind;
	/** The shader's builds, by name. */
	readonly variants: Builds;
}

/**
 * The kinds whose builds take a set for each GPU path alone, without the bits that pick a set, and
 * the prefix of each set's file name.
 */
const LATER_KINDS = [
	['effect', 'effect'],
	['toneCurve', 'curve'],
] as const;

/** True for a kind of compiled WGSL whose builds load on first use. */
function isBuildKind(kind: string): kind is BuildKind {
	return kind === 'material' || kind === 'effect' || kind === 'toneCurve';
}

/** The shaders of one module whose builds go to sets, in the order that the module holds them. */
export class ModuleBuilds {
	readonly sources: BuildSource[] = [];
	/** How many shaders of each kind the module gave, which numbers their records in a set. */
	private readonly counts = new Map<BuildKind, number>();

	/**
	 * The JavaScript expression of `shader` in a module that `pack` packs, as `ShaderPack.value`
	 * gives it. The value of a shader whose builds load on first use keeps none: it gets a
	 * function that imports a set.
	 */
	value(pack: ShaderPack, shader: CompiledWgsl, hot?: string): string {
		const kind = shader.kind;
		const variants = isBuildKind(kind)
			? (shader as { readonly variants?: Builds }).variants
			: undefined;
		if (variants === undefined || Object.keys(variants).length === 0)
			return pack.value(shader, hot);
		const index = this.counts.get(kind as BuildKind) ?? 0;
		this.counts.set(kind as BuildKind, index + 1);
		this.sources.push({ kind: kind as BuildKind, variants });
		// A custom effect that does not join the effect before it draws a pass of its own, so its
		// pieces never reach a host. The module keeps none of them, as it keeps none of its builds.
		const pieces =
			kind === 'effect' && (shader as { readonly joins?: boolean }).joins === false
				? EMPTY_PIECES
				: (shader as { readonly pieces?: object }).pieces;
		return pack.value(
			{
				...shader,
				variants: {},
				permutations: permutationsOf(variants),
				...(pieces && { pieces }),
			},
			hot,
			index,
			kind as BuildKind,
		);
	}
}

/** One set of a module's builds that load on first use, as its own module carries them. */
export interface BuildSet {
	/** The module's name, which tells the set's builds apart from a build of other ones. */
	readonly name: string;
	/** The kind, the GPU path and the permutation bits of the set, as the engine names it:
	 * `"material wgsl 2"`. */
	readonly key: string;
	/** The builds of each shader of the module that the set serves, by name. */
	readonly records: readonly Builds[];
}

/** The builds of `variants` that the GPU path `target` draws, and no output for the other path. */
function onlyTarget(variants: Builds, target: Target): Builds {
	const kept: Record<string, ShaderVariant> = {};
	for (const [name, build] of Object.entries(variants)) {
		if (build[target] === null) continue;
		kept[name] = {
			permutation: build.permutation,
			wgsl: target === 'wgsl' ? build.wgsl : null,
			glsl: target === 'glsl' ? build.glsl : null,
		};
	}
	return kept;
}

/** The builds of the shaders of `kind` in `sources`, in the module's order. */
function variantsOf(sources: readonly BuildSource[], kind: BuildKind): Builds[] {
	return sources.filter((source) => source.kind === kind).map((source) => source.variants);
}

/** The set of `records`, named after its bits and a hash of its builds. */
function setOf(bits: string, key: string, records: readonly Builds[]): BuildSet {
	const json = JSON.stringify(records);
	const digest = createHash('sha256').update(json).digest('hex').slice(0, 16);
	return { name: `${bits}-${digest}`, key, records };
}

/**
 * The sets that hold `sources`' builds: for a material one for each GPU path and value of its fixed
 * bits, and for an effect or a tone curve one for each GPU path. Each set holds the builds of every
 * shader of its kind that the set serves.
 */
export function buildSets(sources: readonly BuildSource[]): BuildSet[] {
	const sets: BuildSet[] = [];
	for (const target of ['wgsl', 'glsl'] as const) {
		const materials = variantsOf(sources, 'material');
		if (materials.length > 0)
			for (const set of setsOf(target)) {
				const records = materials.map((variants) => buildsOfSet(variants, target, set));
				if (records.every((record) => Object.keys(record).length === 0)) continue;
				sets.push(setOf(`material-${target}-${set}`, `material ${target} ${set}`, records));
			}
		for (const [kind, prefix] of LATER_KINDS) {
			const shaders = variantsOf(sources, kind);
			if (shaders.length === 0) continue;
			const records = shaders.map((variants) => onlyTarget(variants, target));
			if (records.every((record) => Object.keys(record).length === 0)) continue;
			sets.push(setOf(`${prefix}-${target}-0`, `${kind} ${target} 0`, records));
		}
	}
	return sets;
}

/** The code of the module that holds one set of builds. */
export function setModule(records: readonly Builds[]): string {
	const pack = new ShaderPack();
	return `export default ${pack.value(records)};\n${pack.unpacker()}`;
}

/**
 * The function that imports the set of builds that a shader needs when the engine first needs it,
 * or nothing for a module without sets. `address` gives the module of each set, which is a virtual
 * module on the dev server and a file beside the module in a packed package.
 */
export function loadBuilds(sets: readonly BuildSet[], address: (name: string) => string): string {
	if (sets.length === 0) return '';
	const loaders = sets.map(
		({ name, key }) => `${JSON.stringify(key)}: () => import(${JSON.stringify(address(name))})`,
	);
	return `
function ${LOAD_BUILDS}(kind, target, set) {
	const load = {
		${loaders.join(',\n\t\t')},
	}[kind + ' ' + target + ' ' + set];
	return load ? load() : Promise.resolve({ default: [] });
}
`;
}

/** The sets of builds that the plugin wrote, by the name of each set's virtual module. */
export class MaterialBuilds {
	private readonly sets = new Map<string, Builds[]>();
	/** The names of the sets of each module, so a module's new compile drops its old sets. */
	private readonly owners = new Map<string, Set<string>>();

	/**
	 * The code that ends module `file`, whose shaders `builds` holds: the function that imports
	 * each set, or nothing for a module without such shaders. The sets of the module's previous
	 * compile go, unless another module has the same.
	 */
	finish(file: string, builds: ModuleBuilds): string {
		const sets = buildSets(builds.sources);
		const names = new Set(sets.map((set) => set.name));
		for (const set of sets) this.sets.set(set.name, [...set.records]);
		const before = this.owners.get(file);
		if (names.size > 0) this.owners.set(file, names);
		else this.owners.delete(file);
		for (const name of before ?? [])
			if (!names.has(name) && !this.owned(name)) this.sets.delete(name);
		return loadBuilds(sets, (name) => `${MATERIAL_BUILDS}${name}`);
	}

	/** The code of the virtual module `id`, or undefined for a module that this plugin did not name. */
	module(id: string): string | undefined {
		const records = this.sets.get(id.slice(id.lastIndexOf('/') + 1));
		return records && setModule(records);
	}

	/** True when a module's current compile has the set named `name`. */
	private owned(name: string): boolean {
		for (const names of this.owners.values()) if (names.has(name)) return true;
		return false;
	}
}
