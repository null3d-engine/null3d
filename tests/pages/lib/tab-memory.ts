// The tab memory test: what it grows, how a growth ends, what the page reports, and how the runner
// tool judges and tabulates it. The page (tests/pages/tab-memory.ts) and the runner tool share it.

/** What the page grows: GPU textures or GPU buffers on one GPU path, or a shared WebAssembly memory. */
export const GROWTH_KINDS = ['texture', 'buffer', 'wasm'] as const;
export type GrowthKind = (typeof GROWTH_KINDS)[number];

/**
 * How a growth ended: the browser closed the tab, refused an allocation, or took the GPU away; the
 * page reached its cap; or a step gave no answer in time.
 */
export const GROWTH_ENDS = ['tab', 'refused', 'lost', 'cap', 'stalled'] as const;
export type GrowthEnd = (typeof GROWTH_ENDS)[number];

/** Each allocation: a 2048 x 2048 RGBA8 texture, or a buffer of the same size, in MiB. */
export const UNIT_MIB = 16;
/** MiB that each step adds unless ?step= says otherwise. */
export const STEP_MIB = 32;
/** The cap in MiB unless ?most= says otherwise: more than any phone or tablet gives one tab. */
export const MOST_MIB = 8192;
/** The largest shared WebAssembly memory, which the core declares as its own limit too. */
export const WASM_MOST_MIB = 4096;

/** What the page posts after each step that lived, and publishes at the end. */
export interface GrowthProgress {
	kind: GrowthKind;
	/** The GPU path that holds the textures or buffers, or null for WebAssembly memory. */
	gpu: 'webgpu' | 'webgl2' | null;
	stepMiB: number;
	/** MiB allocated, filled and used by the last step that lived. */
	livedMiB: number;
	/** Steps that lived. */
	steps: number;
	/** Milliseconds from the first step's start until the last step that lived ended. */
	elapsedMs: number;
}

/** The page's result: how far it got, how the growth ended and why. */
export interface GrowthResult extends GrowthProgress {
	end: GrowthEnd;
	/** The browser's message, for a refused allocation or a lost GPU. */
	reason?: string;
	/** The cap that the page stopped at. */
	mostMiB: number;
}

/** The switches of the page: what to grow, on which GPU path, in which steps, up to which cap. */
export interface GrowthSwitches {
	kind: GrowthKind;
	gpu: 'webgpu' | 'webgl2' | null;
	stepMiB: number;
	mostMiB: number;
	/** The dev server address to post each step's progress to, or null to post nothing. */
	progress: string | null;
}

/** A whole number of MiB from the switch, a multiple of a unit, or the default. */
function wholeUnits(text: string | null, fallback: number, name: string): number {
	if (text === null) return fallback;
	const mib = Number(text);
	if (!(Number.isSafeInteger(mib) && mib >= UNIT_MIB && mib % UNIT_MIB === 0))
		throw new Error(`?${name}=${text} is not valid: use MiB in multiples of ${UNIT_MIB}.`);
	return mib;
}

/** Reads the page's switches, and says how to fix a wrong one. */
export function readGrowthSwitches(params: URLSearchParams): GrowthSwitches {
	const kind = GROWTH_KINDS.find((k) => k === params.get('kind'));
	if (!kind) throw new Error(`Add ?kind= with one of ${GROWTH_KINDS.join(', ')}.`);
	const gpuText = params.get('gpu');
	const gpu = gpuText === 'webgpu' || gpuText === 'webgl2' ? gpuText : null;
	if (kind !== 'wasm' && !gpu) throw new Error(`Add ?gpu=webgpu or ?gpu=webgl2 to grow ${kind}s.`);
	const most = wholeUnits(params.get('most'), MOST_MIB, 'most');
	return {
		kind,
		gpu: kind === 'wasm' ? null : gpu,
		stepMiB: wholeUnits(params.get('step'), STEP_MIB, 'step'),
		mostMiB: kind === 'wasm' ? Math.min(most, WASM_MOST_MIB) : most,
		progress: params.get('progress'),
	};
}

/** The fields that a result or a progress record holds, where they hold them. */
type Facts = Partial<GrowthResult> & Record<string, unknown>;

/**
 * What is wrong with a tab memory page's outcome; empty when nothing is. Every end counts as an
 * answer, the browser closing the tab included, as long as the page or its progress tells how far
 * it got. A page that the runner gave up on counts as stalled, at its last progress.
 */
export function growthProblems(result: Facts, progress: Facts | undefined): string[] {
	if (result.ok !== true && !progress)
		return [`${String(result.error ?? 'the page failed')}, before it posted any progress`];
	const facts = outcomeOf(result, progress);
	if (typeof facts.livedMiB !== 'number') return ['the page reported no step'];
	return [];
}

/**
 * The outcome to report: the page's own result, or, for a page that published none in time, its
 * last progress, as a stall.
 */
export function outcomeOf(result: Facts | undefined, progress: Facts | undefined): Facts {
	if (result?.ok === true && typeof result.end === 'string') return result;
	return { ...progress, end: result ? 'stalled' : undefined, reason: result?.error as string };
}

/** How each end reads in the summary. */
const END_TEXT: Record<GrowthEnd, string> = {
	tab: 'the browser closed the tab',
	refused: 'the browser refused an allocation',
	lost: 'the browser took the GPU away',
	cap: 'the page reached its cap',
	stalled: 'a step gave no answer in time',
};

/** One row of the summary table, for an item with the given result and progress. */
export function growthRow(
	label: { kind: GrowthKind; gpu?: string; round: number },
	result: Facts | undefined,
	progress: Facts | undefined,
): string {
	const facts = outcomeOf(result, progress);
	const where = `${label.kind} | ${label.gpu ?? '-'} | ${label.round}`;
	if (typeof facts.livedMiB !== 'number')
		return `| ${where} | - | - | ${result ? String(result.error ?? 'no step lived') : 'no result'} | |`;
	const end = facts.end as GrowthEnd | undefined;
	const how = end ? END_TEXT[end] : 'no result, and the runner page never came back';
	const reason = String(facts.reason ?? '').replaceAll('|', '/');
	return `| ${where} | ${facts.livedMiB} | ${facts.steps} | ${how} | ${reason} |`;
}

/** The header of the summary table. */
export const GROWTH_TABLE_HEAD = [
	'| Growth | GPU path | Round | Last MiB that lived | Steps | How it ended | Message |',
	'| --- | --- | --- | --- | --- | --- | --- |',
];
