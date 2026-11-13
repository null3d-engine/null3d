// The coverage list of a review: one line per reference file of the species' folder, with the
// render it was compared with and the result. The owner's rule is that a species is compared with
// every reference it has, so a file in use with no comparison, or a turning video with a frame that
// no render at its angle matched, blocks a pass. Files that the folder's index marks superseded are
// listed apart, as not in use.
import type { StillResult, TurnResult, WindResult } from './compare.ts';
import { fixed } from './compare.ts';
import type { ReferenceSet } from './references.ts';

/**
 * Whether a reference file was compared in full, in part, or not at all, was drawn as a picture
 * that shows no subject, which compares nothing, or is not judged because it shows a stand of
 * plants that one plant cannot draw.
 */
export type CoverageStatus = 'compared' | 'partial' | 'missing' | 'void' | 'not judged';

/** One line of the coverage list. */
export interface CoverageLine {
	readonly file: string;
	readonly kind: string;
	readonly status: CoverageStatus;
	/** The render or renders it was compared with. */
	readonly render: string;
	/** The comparison's result in a few figures, or why there is none. */
	readonly result: string;
}

/** A review's coverage: a line per file in use, the files not in use, and whether any blocks a pass. */
export interface Coverage {
	readonly lines: readonly CoverageLine[];
	readonly superseded: readonly { readonly file: string; readonly by: string }[];
	readonly compared: number;
	readonly inUse: number;
	/** True when every file in use was compared in full. */
	readonly complete: boolean;
}

/** What the run compared, by reference file name. */
export interface Comparisons {
	readonly stills: ReadonlyMap<string, StillResult>;
	readonly turns: ReadonlyMap<string, TurnResult>;
	readonly winds: ReadonlyMap<string, WindResult>;
}

/** The coverage line of a still or a texture source. */
function stillLine(file: string, kind: string, result: StillResult | undefined): CoverageLine {
	if (!result)
		return { file, kind, status: 'missing', render: '-', result: 'not drawn in this run' };
	if (result.error)
		return {
			file,
			kind,
			status: 'missing',
			render: '-',
			result: `the render failed: ${result.error}`,
		};
	// A photograph of a stand is drawn and set beside its reference, and is not judged: it holds
	// no pass back, since no single plant could match it.
	if (result.standing?.kind === 'stand')
		return {
			file,
			kind,
			status: 'not judged',
			render: `${result.renderFile} (view ${result.view})`,
			result: result.standing.reason,
		};
	// A picture whose subject is missing was drawn and compares nothing: the tool's camera, or the
	// file's mapping to a view, is what needs mending before the file counts as compared.
	if (result.void !== undefined)
		return {
			file,
			kind,
			status: 'void',
			render: `${result.renderFile} (view ${result.view})`,
			result: `void: ${result.void}`,
		};
	// A picture with no usable outline still has edges: its directions are the figure it gets.
	const edges =
		result.edgeDifference === null ? '' : `; edge directions ${fixed(result.edgeDifference, 3)}`;
	const figures = result.masked
		? `shape IoU ${fixed(result.shapeIou)}, width error ${fixed(result.profileError, 3)}, leaf ΔE ${fixed(result.foliageDeltaE, 1)}`
		: result.surfaceDeltaE !== null
			? `surface ΔE ${fixed(result.surfaceDeltaE, 1)}`
			: result.foliageDeltaE !== null
				? `leaf ΔE ${fixed(result.foliageDeltaE, 1)}; no outline${edges}`
				: `by eye: no plain outline${edges}`;
	return {
		file,
		kind,
		status: 'compared',
		render: `${result.renderFile} (view ${result.view})`,
		result: `${figures}${result.note ? `; ${result.note}` : ''}`,
	};
}

/** The coverage line of a turning video. */
function turnLine(file: string, result: TurnResult | undefined): CoverageLine {
	const kind = 'turning video';
	if (!result)
		return { file, kind, status: 'missing', render: '-', result: 'not drawn in this run' };
	if (result.error) return { file, kind, status: 'missing', render: '-', result: result.error };
	const status: CoverageStatus =
		result.covered === result.frames ? 'compared' : result.covered > 0 ? 'partial' : 'missing';
	return {
		file,
		kind,
		status,
		render: `${result.renders} renders every ${result.renderStep.toFixed(2)}°`,
		result: `${result.covered} of ${result.frames} frames matched at their angle over ${result.arc}°; shape IoU mean ${result.meanShapeIou === null ? '-' : result.meanShapeIou.toFixed(3)}${status === 'compared' ? '' : `; draw renders at least every ${result.frameStep.toFixed(2)}° to cover every frame`}`,
	};
}

/** The coverage line of a wind video. */
function windLine(file: string, result: WindResult | undefined, interval: number): CoverageLine {
	const kind = 'wind video';
	if (!result)
		return { file, kind, status: 'missing', render: '-', result: 'not drawn in this run' };
	if (result.error) return { file, kind, status: 'missing', render: '-', result: result.error };
	const spans = result.span + result.interval >= result.duration - 1e-3;
	const dense = result.interval <= interval + 1e-6;
	const status: CoverageStatus = spans && dense ? 'compared' : 'partial';
	const top = (values: readonly number[]) => fixed(values.at(-1), 3);
	return {
		file,
		kind,
		status,
		render: `${result.frames} frames, one every ${result.interval.toFixed(3)} s`,
		result: `top-band motion ${top(result.motion.reference)} against ${top(result.motion.render)}${spans ? '' : `; the clip spans ${result.span.toFixed(2)} of ${result.duration.toFixed(2)} s`}`,
	};
}

/**
 * The coverage of a review: every file of the folder, the in-use ones with their comparison. A
 * wind clip counts as compared when it spans the video with a frame at least every `windInterval`
 * seconds.
 */
export function coverageOf(
	set: ReferenceSet,
	comparisons: Comparisons,
	windInterval: number,
): Coverage {
	const lines: CoverageLine[] = [];
	const superseded: { file: string; by: string }[] = [];
	const unknown = new Set(set.unknown);
	for (const reference of set.files) {
		if (!reference.inUse) {
			superseded.push({ file: reference.file, by: reference.supersededBy ?? '-' });
			continue;
		}
		const unlisted = reference.listed ? undefined : 'not in the index';
		let line: CoverageLine;
		if (unknown.has(reference.file))
			line = {
				file: reference.file,
				kind: reference.kind,
				status: 'missing',
				render: '-',
				result: 'no review view matches this file: give it a slot rule',
			};
		else if (reference.kind === 'turntable')
			line = turnLine(reference.file, comparisons.turns.get(reference.file));
		else if (reference.kind === 'wind')
			line = windLine(reference.file, comparisons.winds.get(reference.file), windInterval);
		else
			line = stillLine(
				reference.file,
				reference.kind === 'texture' ? 'texture source' : 'still',
				comparisons.stills.get(reference.file),
			);
		lines.push(unlisted ? { ...line, result: `${line.result}; ${unlisted}` } : line);
	}
	const compared = lines.filter((line) => line.status === 'compared').length;
	const waived = lines.filter((line) => line.status === 'not judged').length;
	return {
		lines,
		superseded,
		compared,
		inUse: lines.length,
		complete: compared + waived === lines.length,
	};
}

/** The coverage list as Markdown. */
export function coverageMarkdown(species: string, slug: string, coverage: Coverage): string {
	const cell = (text: string) => text.replaceAll('|', '/');
	return [
		`# Coverage of ${species} against ${slug}`,
		'',
		coverage.complete
			? `Every one of the ${coverage.inUse} reference files in use was compared with a render.`
			: `${coverage.compared} of ${coverage.inUse} reference files in use were compared in full. The species cannot pass until the others are.`,
		'',
		'| Reference | Kind | Compared with | Result | Status |',
		'| --- | --- | --- | --- | --- |',
		...coverage.lines.map(
			(line) =>
				`| \`${line.file}\` | ${line.kind} | ${cell(line.render)} | ${cell(line.result)} | ${line.status} |`,
		),
		'',
		'## Not in use',
		'',
		...(coverage.superseded.length === 0
			? ['None.']
			: coverage.superseded.map((entry) => `- \`${entry.file}\`: superseded by ${entry.by}.`)),
		'',
	].join('\n');
}
