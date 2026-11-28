// Shader variants by permutation word. The shader build makes a variant of a template's shader for
// each combination of the permutation bits it lists, and records those bits in the variant. Each
// backend builds a render pipeline from the variant that the pipeline's permutation word names.

import { PERMUTATION_DRAW_INDEX, PERMUTATION_HALF, PERMUTATION_TONE_MAP } from '../generated/gpu';
import { LISTED_PERMUTATIONS } from '../generated/shader-permutations';
import type { ShaderVariant, ShaderVariants } from '../generated/shaders';
import { DEV } from '../shared/dev';

/** The variant built with exactly the bits of `permutation`, with output for `target`. */
function exactly<Pipeline extends string>(
	shader: ShaderVariants<Pipeline>,
	permutation: number,
	target: 'wgsl' | 'glsl',
): ShaderVariant<Pipeline> | undefined {
	for (const name in shader) {
		const variant = shader[name] as ShaderVariant<Pipeline>;
		if (variant.permutation === permutation && variant[target] !== null) return variant;
	}
	return undefined;
}

/**
 * The permutation words that the pipelines asked for while a recording runs, or undefined when no
 * recording runs. A page records them to list the words that its scene draws with, which a narrowed
 * build then builds.
 */
let recorded: Set<number> | undefined;

/** Hears each word that a recording adds, so a live page streams its growing set to its tool. */
let recordedSink: ((word: number) => void) | undefined;

/**
 * The bits that a device fixes when it starts, which a recorded word leaves out. One list then
 * serves every device module, and a build makes the word's builds for each value of those bits.
 */
const DEVICE_BITS = PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP | PERMUTATION_HALF;

/** The word as a list writes it: without the bits that a device fixes. */
export function listedWord(permutation: number): number {
	return (permutation & ~DEVICE_BITS) >>> 0;
}

/**
 * The error for a pipeline whose loaded shader set has no variant that it asks for. Its `word` is
 * the word as a list writes it, which names the entry to add.
 */
export class MissingVariantError extends Error {
	constructor(
		readonly word: number,
		message: string,
	) {
		super(message);
		this.name = 'MissingVariantError';
	}
}

/** Hears each object pipeline whose variant the loaded shader set lacks, so its draws can skip. */
let missingSink: ((pipeline: string, word: number) => void) | undefined;

/**
 * @internal Hears each object pipeline whose shader variant the loaded set lacks. The drawing
 * thread sets this to publish the word, and the page logs one warning for it. A production build
 * keeps the report, because a narrowed production build is where it matters.
 */
export function receiveMissingVariants(sink?: (pipeline: string, word: number) => void): void {
	missingSink = sink;
}

/** Reports an object pipeline whose shader variant the loaded set lacks, for its draws to skip. */
export function reportMissingVariant(pipeline: string, word: number): void {
	missingSink?.(pipeline, word);
}

/**
 * @internal Starts collecting the permutation words that the pipelines ask for, until
 * [`stopRecordingPermutations`]. A word that a pipeline found is added once, and `onWord` hears
 * each one as it arrives so a live page streams its growing set to its tool.
 */
export function recordPermutations(onWord?: (word: number) => void): void {
	recorded = new Set();
	recordedSink = onWord;
}

/** @internal Stops collecting, and gives the words collected since, in order. */
export function stopRecordingPermutations(): number[] {
	const words = [...(recorded ?? [])].sort((a, b) => a - b);
	recorded = undefined;
	recordedSink = undefined;
	return words;
}

/**
 * In a development build, the words that this thread has reported, and where it reports each new
 * one. The dev server compares them with the project's shader list, so a word that a production
 * build with the list lacks shows while the page runs, not first in the built page.
 */
let reporting: { readonly words: Set<number>; readonly report: (word: number) => void } | undefined;

/**
 * @internal In a development build, hands `report` each permutation word that a pipeline finds
 * from now on, once per word, as a recording lists it. A production build reports nothing.
 */
export function reportPermutations(report: (word: number) => void): void {
	if (DEV) reporting = { words: new Set(), report };
}

/**
 * The variant of a shader for a pipeline's permutation word, with output for `target`, or
 * undefined when the shader has none. The word never holds the half precision bit, which the
 * device fixes by the shader module it loads: only the module of a device that draws at half
 * precision holds builds with that bit, and only of the shaders that do color math. So a shader's
 * build with the bit wins where it has one, and the others draw as on any device.
 */
export function variantFor<Pipeline extends string>(
	shader: ShaderVariants<Pipeline>,
	permutation: number,
	target: 'wgsl' | 'glsl',
): ShaderVariant<Pipeline> | undefined {
	// The word's top bit makes JavaScript's `|` negative, so the result turns back to unsigned.
	const half = (permutation | PERMUTATION_HALF) >>> 0;
	const found = exactly(shader, half, target) ?? exactly(shader, permutation, target);
	// A recording lists the words that the scene draws with, so a narrowed build builds them. The
	// bits a device fixes are left out, so one list holds the words of every device module.
	// A development build reports the same words to the dev server.
	if (found !== undefined) {
		const word = listedWord(permutation);
		if (recorded !== undefined && !recorded.has(word)) {
			recorded.add(word);
			recordedSink?.(word);
		}
		if (DEV && reporting !== undefined && !reporting.words.has(word)) {
			reporting.words.add(word);
			reporting.report(word);
		}
	}
	return found;
}

/**
 * The message for a pipeline whose variant no loaded module holds. A variant that loads on first
 * use is absent until its module arrives, so only a caller that has waited for every module calls
 * this. A set narrowed to a project's list names the word to add, as the list writes it, without
 * the bits that a device fixes. A full set names the word that its manifest cannot make.
 */
export function missingVariant(permutation: number, listed = LISTED_PERMUTATIONS !== null): string {
	if (!listed)
		return `the shader set has no variant for the permutation word 0x${(permutation >>> 0).toString(16)}.`;
	const word = `0x${listedWord(permutation).toString(16).padStart(8, '0')}`;
	return `the shader set holds only the permutation words of the project's shader list, and this pipeline asks for ${word}, which the list lacks. Record the pages again with bunx @null3d/cli shaders record so that the word reaches the list, or add ${word} to the list by hand, and build again.`;
}

/**
 * The message for an engine pass whose shader, which the device's modules hold from the start, no
 * module holds with the word `permutation`. A set narrowed to a project's list names the word
 * that the list lacks, as `missingVariant` does.
 */
export function missingShader(
	name: string,
	permutation: number,
	listed = LISTED_PERMUTATIONS !== null,
): string {
	return listed
		? `the ${name} shader is missing: ${missingVariant(permutation, true)}`
		: `the device's shader modules have no ${name} shader`;
}
