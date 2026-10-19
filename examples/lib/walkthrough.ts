// The guided walkthrough of a comparison: an intro, null3D's ramp, three.js's ramp on the same
// counts, and a summary of both. Each engine draws on a page of its own, so a step names the engine
// whose page runs it and whether that page must load again. The summary joins the two ramps by
// count, marks each figure that sits at the display's rate, and says which engine drew more frames
// a second where the two differ. Nothing here imports an engine, so the unit tests drive the flow
// and the summary with fake ramps.

import type { EngineName } from './compare';
import type { RampResult } from './ramp';

/** The steps that the walkthrough passes through, in order. */
export type WalkthroughStep = 'intro' | 'null3d-ramp' | 'threejs-ramp' | 'summary' | 'stopped';

/** What the viewer or the ramp asks the walkthrough to do. */
export type WalkthroughAction = 'start' | 'done' | 'skip' | 'stop' | 'restart';

/** Where the walkthrough stands: its step, and the engine whose page runs it. */
export interface WalkthroughState {
	readonly step: WalkthroughStep;
	readonly engine: EngineName;
}

/** The next state of the walkthrough, and whether it needs a page of its own. */
export interface WalkthroughMove extends WalkthroughState {
	/**
	 * True when the step runs on the other engine's page, so the page loads again: a canvas draws
	 * for one engine at a time.
	 */
	readonly reload: boolean;
}

/**
 * The walkthrough's state machine. A page creates it at the step that the address names, sends it
 * what the viewer does, and loads again when a move names the other engine. A stop is final: no
 * later action moves it, except a restart from the summary or the stopped screen.
 */
export class WalkthroughFlow {
	private state: WalkthroughState;

	constructor(engine: EngineName, step: WalkthroughStep = 'intro') {
		this.state = { step, engine };
	}

	get step(): WalkthroughStep {
		return this.state.step;
	}

	get engine(): EngineName {
		return this.state.engine;
	}

	/** The move for an action, or null when the action does nothing at this step. */
	act(action: WalkthroughAction): WalkthroughMove | null {
		const { step, engine } = this.state;
		switch (action) {
			case 'start':
				// null3D draws first, whatever page the viewer arrives on.
				if (step === 'intro') return this.move('null3d-ramp', 'null3d');
				return null;
			case 'restart':
				if (step === 'summary' || step === 'stopped') return this.move('intro', 'null3d');
				return null;
			case 'skip':
			case 'done':
				if (step === 'null3d-ramp') return this.move('threejs-ramp', 'threejs');
				if (step === 'threejs-ramp') return this.move('summary', 'threejs');
				return null;
			case 'stop':
				return step === 'stopped' ? null : this.move('stopped', engine);
		}
	}

	private move(step: WalkthroughStep, engine: EngineName): WalkthroughMove {
		const reload = engine !== this.state.engine;
		this.state = { step, engine };
		return { step, engine, reload };
	}
}

/**
 * The step that a page starts at: `?walkthrough=go` continues a run, and any other value, or no
 * value, shows the intro. A three.js page continues only when the first ramp is kept.
 */
export function startingStep(
	walkthrough: string | null,
	engine: EngineName,
	hasFirstRamp: boolean,
): WalkthroughStep {
	if (walkthrough !== 'go') return 'intro';
	if (engine === 'null3d') return 'null3d-ramp';
	return hasFirstRamp ? 'threejs-ramp' : 'intro';
}

/** One engine's ramp, with what the summary needs to read it. */
export interface WalkthroughRamp {
	engine: EngineName;
	/** The engine, its version and its renderer, as the page shows them. */
	label: string;
	/** The GPU path that the engine drew with. */
	gpu: 'webgpu' | 'webgl2';
	/** The display's rate, in frames a second, as the walkthrough measured it. */
	hz: number;
	/** True when the viewer skipped part of the ramp, so its counts are not all measured. */
	skipped: boolean;
	result: RampResult;
}

/** What the walkthrough keeps for the session between the two engines' pages. */
export interface WalkthroughRun {
	/** The display's rate, in frames a second, or 0 before the walkthrough measured it. */
	hz: number;
	ramps: WalkthroughRamp[];
}

const storageKey = (comparison: string, mode: string) =>
	`null3d-compare-walkthrough:${comparison}:${mode}`;

/** The run that the session keeps for a comparison in a mode, or an empty one. */
export function readWalkthrough(comparison: string, mode: string): WalkthroughRun {
	try {
		const kept = JSON.parse(
			sessionStorage.getItem(storageKey(comparison, mode)) ?? '{}',
		) as Partial<WalkthroughRun>;
		return {
			hz: typeof kept.hz === 'number' && Number.isFinite(kept.hz) ? kept.hz : 0,
			ramps: Array.isArray(kept.ramps) ? kept.ramps : [],
		};
	} catch {
		return { hz: 0, ramps: [] };
	}
}

/** Keeps the run for the session, so the other engine's page and a reload can read it. */
export function writeWalkthrough(comparison: string, mode: string, run: WalkthroughRun): void {
	try {
		sessionStorage.setItem(storageKey(comparison, mode), JSON.stringify(run));
	} catch {
		// Without session storage, each page shows the engine that ran on it alone.
	}
}

/** Forgets the run, as a stop or a fresh start asks. */
export function clearWalkthrough(comparison: string, mode: string): void {
	try {
		sessionStorage.removeItem(storageKey(comparison, mode));
	} catch {
		// Nothing is kept when the browser refuses storage.
	}
}

/**
 * True when a figure sits at the display's own rate, within the measurement's noise: five per cent
 * of the rate, and at least one frame a second. A rate of 0 means that no measurement was made.
 */
export function atDisplayCap(fps: number, hz: number): boolean {
	if (hz <= 0 || fps <= 0) return false;
	return fps >= hz - Math.max(1, hz * 0.05);
}

/** One count's figures from both engines. */
export interface SummaryRow {
	count: number;
	/** null3D's frames a second, or null when it did not draw at the count. */
	null3d: number | null;
	threejs: number | null;
	/** null3D's frames a second for each of three.js's, where both drew. */
	ratio: number | null;
	null3dAtCap: boolean;
	threejsAtCap: boolean;
}

/** A step's frames a second, or null when the step drew nothing. */
function stepFps(result: RampResult | undefined): Map<number, number | null> {
	const figures = new Map<number, number | null>();
	for (const step of result?.steps ?? [])
		figures.set(step.count, step.noFrame || !(step.fps > 0) ? null : step.fps);
	return figures;
}

/** Both ramps' counts in ascending order, with each engine's figure where it drew. */
export function summaryRows(
	null3d: RampResult | undefined,
	threejs: RampResult | undefined,
	hz: number,
): SummaryRow[] {
	const first = stepFps(null3d);
	const second = stepFps(threejs);
	const counts = [...new Set([...first.keys(), ...second.keys()])].sort((a, b) => a - b);
	return counts.map((count) => {
		const a = first.get(count) ?? null;
		const b = second.get(count) ?? null;
		return {
			count,
			null3d: a,
			threejs: b,
			ratio: a !== null && b !== null && b > 0 ? a / b : null,
			null3dAtCap: a !== null && atDisplayCap(a, hz),
			threejsAtCap: b !== null && atDisplayCap(b, hz),
		};
	});
}

/** The counts at which one engine drew more frames a second than the other. */
export interface SummaryWins {
	null3d: number[];
	threejs: number[];
	/**
	 * The counts where both engines drew, and where a difference in frame rate says something: both
	 * at the display's rate says nothing, since the display sets the pace for each.
	 */
	measured: number[];
}

/** Which engine drew more frames a second at each count where both drew. */
export function summaryWins(rows: readonly SummaryRow[]): SummaryWins {
	const wins: SummaryWins = { null3d: [], threejs: [], measured: [] };
	for (const row of rows) {
		if (row.null3d === null || row.threejs === null) continue;
		if (row.null3dAtCap && row.threejsAtCap) continue;
		wins.measured.push(row.count);
		if (row.null3d > row.threejs) wins.null3d.push(row.count);
		else if (row.threejs > row.null3d) wins.threejs.push(row.count);
	}
	return wins;
}

/**
 * The sentences that say which engine drew more frames a second, in the summary's plain words. A
 * count where both sat at the display's rate is left out, since neither engine set that rate.
 */
export function winsSentences(wins: SummaryWins): string[] {
	const total = wins.measured.length;
	if (total === 0) return [];
	const sentences: string[] = [];
	if (wins.null3d.length > 0)
		sentences.push(
			`null3D drew more frames a second at ${wins.null3d.length} of the ${total} counts where neither engine sat at the display cap.`,
		);
	if (wins.threejs.length > 0)
		sentences.push(
			`three.js drew more frames a second at ${wins.threejs.length} of the ${total} counts where neither engine sat at the display cap.`,
		);
	return sentences;
}
