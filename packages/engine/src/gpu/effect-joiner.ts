// Joins custom effects' pieces into a host's builds, for one GPU path, as text. The thread that
// draws loads this module the first time a group of effects or a fold needs its shader
// (`effect-join.ts`), so pages without joined effects never download it.
//
// A join puts every member's items before the host's `effect_chain`, each item that two members
// share once, and writes in the chain's place a chain that calls each member's run function with
// the color that the member before it returned and the member's slot, the place of its uniform
// block. A tone curve's items and a call to it take the place of the final pass's
// `tone_curve_hook`. Only text moves, so a join takes about as long as copying the shader.

import { PERMUTATION_DEPTH_MULTISAMPLED } from '../generated/gpu';
import type { ShaderVariant, ShaderVariants } from '../generated/shaders';
import type { GlslPiece, JoinMember, PieceBuilds, ShaderPiece, WgslPiece } from './effect-join';

/** The name of a build's DEPTH_MULTISAMPLED twin, as the shader build names builds. */
const MULTISAMPLED_SUFFIX = '_depth_multisampled';

/**
 * The builds of a host joined with `members`, in order, and with `curve` where the host has the
 * tone curve's hook, for `target`. Each of the host's builds for the target gives one build, and
 * on WebGPU a DEPTH_MULTISAMPLED twin when a member reads depth.
 */
export function joinShaders(
	host: ShaderVariants,
	members: readonly JoinMember[],
	curve: PieceBuilds | undefined,
	target: 'wgsl' | 'glsl',
): ShaderVariants {
	const joined: Record<string, ShaderVariant> = {};
	for (const [name, build] of Object.entries(host)) {
		if (build.permutation !== 0 || !build[target]) continue;
		const multisampled =
			target === 'wgsl' && members.some((m) => m.pieces[name + MULTISAMPLED_SUFFIX]);
		for (const twin of multisampled ? [false, true] : [false]) {
			const pieceOf = (pieces: PieceBuilds): ShaderPiece => {
				const piece = (twin && pieces[name + MULTISAMPLED_SUFFIX]) || pieces[name];
				if (!piece) throw new Error(`an effect has no piece for the host's build ${name}`);
				return piece;
			};
			const pieces = members.map((member) => ({
				piece: pieceOf(member.pieces),
				slot: member.slot,
			}));
			const curvePiece = curve ? pieceOf(curve) : undefined;
			const permutation = twin ? PERMUTATION_DEPTH_MULTISAMPLED : 0;
			joined[twin ? name + MULTISAMPLED_SUFFIX : name] =
				target === 'wgsl'
					? joinWgsl(build, pieces, curvePiece, permutation)
					: joinGlsl(build, pieces, curvePiece, permutation);
		}
	}
	return joined;
}

/** A member's piece of one build, and its slot. */
interface Placed {
	readonly piece: ShaderPiece;
	readonly slot: number;
}

function joinWgsl(
	build: ShaderVariant,
	members: readonly Placed[],
	curve: ShaderPiece | undefined,
	permutation: number,
): ShaderVariant {
	const wgsl = build.wgsl as NonNullable<ShaderVariant['wgsl']>;
	const pieces = members.map(({ piece, slot }) => ({ piece: piece.wgsl as WgslPiece, slot }));
	let source = wgsl.source;
	if (curve?.wgsl) {
		const hook = `fn tone_curve_hook(color: vec3<f32>) -> vec3<f32> {\n    return saturate(${curve.wgsl.run}(color));\n}\n`;
		source = replaceFunction(source, 'tone_curve_hook', curve.wgsl.items, hook);
	}
	let chain = 'fn effect_chain(start: EffectInput) -> vec4<f32> {\n    var link = start;\n';
	for (const { piece, slot } of pieces) chain += `    link.color = ${piece.run}(link, ${slot}u);\n`;
	chain += '    return link.color;\n}\n';
	source = replaceFunction(
		source,
		'effect_chain',
		pieces.flatMap(({ piece }) => piece.items),
		chain,
	);
	return { permutation, wgsl: { source, pipelines: wgsl.pipelines }, glsl: null };
}

function joinGlsl(
	build: ShaderVariant,
	members: readonly Placed[],
	curve: ShaderPiece | undefined,
	permutation: number,
): ShaderVariant {
	const programs = build.glsl as NonNullable<ShaderVariant['glsl']>;
	const program = programs.main;
	if (!program) throw new Error("a host's GLSL build has no main program");
	const pieces = members.map(({ piece, slot }) => ({ piece: piece.glsl as GlslPiece, slot }));
	let source = program.fragment.source;
	const added: GlslPiece[] = pieces.map(({ piece }) => piece);
	if (curve?.glsl) {
		const hook = `vec3 tone_curve_hook(vec3 color) {\n    return clamp(${curve.glsl.run}(color), vec3(0.0), vec3(1.0));\n}\n`;
		source = replaceFunction(source, 'tone_curve_hook', curve.glsl.items, hook);
		added.push(curve.glsl);
	}
	let chain = 'vec4 effect_chain(EffectInput start) {\n    EffectInput link = start;\n';
	for (const { piece, slot } of pieces) chain += `    link.color = ${piece.run}(link, ${slot}u);\n`;
	chain += '    return link.color;\n}\n';
	source = replaceFunction(
		source,
		'effect_chain',
		pieces.flatMap(({ piece }) => piece.items),
		chain,
	);
	const fragment = {
		source,
		uniformBlocks: merged(program.fragment.uniformBlocks, added, (p) => p.uniformBlocks),
		textures: merged(program.fragment.textures, added, (p) => p.textures),
	};
	return { permutation, wgsl: null, glsl: { main: { vertex: program.vertex, fragment } } };
}

/**
 * A host's blocks or textures with those that pieces add, by name: a piece's entry takes the place
 * of the host's entry of the same name, as for a texture that the piece samples with a sampler.
 */
function merged<T extends { readonly name: string }>(
	own: readonly T[],
	pieces: readonly GlslPiece[],
	of: (piece: GlslPiece) => readonly T[],
): T[] {
	const byName = new Map(own.map((entry) => [entry.name, entry]));
	for (const piece of pieces) for (const entry of of(piece)) byName.set(entry.name, entry);
	return [...byName.values()];
}

/**
 * `source` with its top-level function `name` replaced by `items`, each once and in order, and
 * then `replacement`. naga starts a top-level function's line at its first column, and indents
 * every call, so the definition is the one line that starts unindented and names `name(`.
 */
export function replaceFunction(
	source: string,
	name: string,
	items: readonly string[],
	replacement: string,
): string {
	const call = ` ${name}(`;
	let start = 0;
	for (;;) {
		const at = source.indexOf(call, start);
		if (at < 0) throw new Error(`the host's shader has no function ${name}`);
		const line = source.lastIndexOf('\n', at) + 1;
		const first = source.charCodeAt(line);
		// A space, a tab or a closing brace starts an indented or a nested line.
		if (first !== 32 && first !== 9 && first !== 125) {
			const open = source.indexOf('{', at);
			let depth = 0;
			for (let k = open; k < source.length; k++) {
				const c = source.charCodeAt(k);
				if (c === 123) depth++;
				else if (c === 125 && --depth === 0) {
					const end = source.indexOf('\n', k);
					const after = end < 0 ? source.length : end + 1;
					return (
						source.slice(0, line) +
						unique(items).join('\n') +
						'\n' +
						replacement +
						source.slice(after)
					);
				}
			}
			throw new Error(`the host's function ${name} does not close`);
		}
		start = at + call.length;
	}
}

/** The items, each once, in the order of their first place. */
function unique(items: readonly string[]): string[] {
	return [...new Set(items)];
}
