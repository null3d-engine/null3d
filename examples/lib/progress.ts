// The loading progress that a scene posts to the page's loading overlay, and the models that the
// overlay keeps: the overall figure of its main bar, the phase of each lane that runs beside it,
// and the percentage each counted phase shows. A scene that loads files posts the bytes that have
// arrived, against the bytes that the files announced. A scene that builds without files names the
// phase it is in, and the overlay holds its bar moving while it waits. `examples/lib/run.ts` draws
// all of them, with the engine's own start stages in the engine's lane.
import type { SketchContext } from '@null3d/engine';

/** What a loading bar shows for one phase of a start. */
export interface LoadPhase {
	/** Names the work that the figures measure. A new key starts a new measure. */
	key: string;
	/** The line that names what is happening. */
	text: string;
	/** A second line with the count, such as the bytes of a total. */
	detail?: string;
	/** How far the phase has gone, from 0 to 1, when its work is counted. */
	value?: number;
}

/**
 * The lane that a phase belongs to. The engine's own start, the scene's file downloads and the
 * scene's own build run side by side, so each keeps a phase of its own: a new engine stage ends the
 * engine's previous phase without hiding the downloads, and a scene milestone does not hide the
 * bytes bar that runs beside it.
 */
export type LoadLane = 'engine' | 'files' | 'scene';

/** The order in which the overlay draws the lanes, the engine's first. */
export const LOAD_LANES: readonly LoadLane[] = ['engine', 'files', 'scene'];

/**
 * The phases that the loading overlay shows under its main bar. Each lane holds one phase at a
 * time: a phase appears when its work begins and gives way when the next phase of its lane begins,
 * so a finished phase never keeps a bar.
 */
export class LoadPhases {
	private readonly lanes: Record<LoadLane, LoadPhase | undefined> = {
		engine: undefined,
		files: undefined,
		scene: undefined,
	};

	/** Shows the phase in its lane, replacing the phase that ran there before it. */
	show(lane: LoadLane, phase: LoadPhase): void {
		this.lanes[lane] = phase;
	}

	/** Ends the lane's phase, when its work is over and the next phase has not begun. */
	clear(lane: LoadLane): void {
		this.lanes[lane] = undefined;
	}

	/** The phases to draw, in lane order, with the lane that holds each. */
	list(): { lane: LoadLane; phase: LoadPhase }[] {
		const shown: { lane: LoadLane; phase: LoadPhase }[] = [];
		for (const lane of LOAD_LANES) {
			const phase = this.lanes[lane];
			if (phase) shown.push({ lane, phase });
		}
		return shown;
	}
}

/** The share of the main bar that the engine's own download fills. */
const ENGINE_SHARE = 0.2;
/** The share at which the scene's file downloads begin and end. */
const FILES_FROM = 0.35;
const FILES_TO = 0.8;
/** The share at which the scene's counted build begins and ends. */
const BUILD_FROM = 0.8;
const BUILD_TO = 0.98;
/** The most of the main bar that a start shows before the first frame is drawn. */
const ALMOST = 0.99;
/** How long an uncounted stretch of work eases toward its ceiling, in ms. */
const EASE_TAU = 2600;

/** A share kept inside the range that a bar can show. */
function shareOf(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * The overall progress of a start, as the overlay's main bar shows it. The countable stretches of a
 * start — the engine's download, the scene's files and the scene's build — fill fixed parts of the
 * bar. The stretches without a count, such as the engine starting and the workers starting, ease
 * toward a mark as time passes, so the main bar keeps moving while the work goes on. The bar holds
 * below a whole until the first frame is drawn.
 */
export class StartMeter {
	private floor = 0;
	private from = 0;
	private ceiling = 0;
	private at = 0;
	private easing = false;

	/** The share that the main bar shows at `now`, from 0 to 1. */
	value(now = performance.now()): number {
		if (!this.easing) return this.floor;
		const eased = 1 - Math.exp(-(now - this.at) / EASE_TAU);
		return Math.min(ALMOST, Math.max(this.floor, this.from + (this.ceiling - this.from) * eased));
	}

	/** True while uncounted work still has a stretch of bar to ease through. */
	moving(now = performance.now()): boolean {
		return this.easing && this.value(now) < this.ceiling - 0.005;
	}

	/** The overlay is up and the page begins its start. */
	begin(now = performance.now()): void {
		this.easeTo(0.1, now);
	}

	/**
	 * The engine's download reached `share` of its bytes, or reports no total, which eases toward
	 * the share that the download fills.
	 */
	engine(share: number | undefined, now = performance.now()): void {
		if (share === undefined || !Number.isFinite(share)) this.easeTo(ENGINE_SHARE, now);
		else this.raise(ENGINE_SHARE * shareOf(share));
	}

	/** The engine waits for the memory that its core needs. */
	waitForMemory(now = performance.now()): void {
		this.easeTo(0.32, now);
	}

	/** The engine's core starts, which it reports no count of. */
	core(now = performance.now()): void {
		this.easeTo(0.45, now);
	}

	/** The engine's workers start, which it reports no count of. */
	workers(now = performance.now()): void {
		this.easeTo(0.6, now);
	}

	/**
	 * The scene's file downloads reached `share` of their bytes. A completed count leaves the bar
	 * easing through the build that follows, which reports no count of its own.
	 */
	files(share: number, now = performance.now()): void {
		this.raise(FILES_FROM + (FILES_TO - FILES_FROM) * shareOf(share));
		if (share >= 1) this.easeTo(0.9, now);
	}

	/** A scene phase begins that reports no count, so the bar eases through it. */
	scene(now = performance.now()): void {
		const current = Math.max(this.floor, this.value(now), this.ceiling);
		this.easeTo(Math.min(0.92, current + 0.08), now);
	}

	/** The scene's counted build reached `share` of its work. A completed build eases toward the frame. */
	build(share: number, now = performance.now()): void {
		this.raise(BUILD_FROM + (BUILD_TO - BUILD_FROM) * shareOf(share));
		if (share >= 1) this.easeTo(ALMOST, now);
	}

	/** The first frame is drawn: a whole bar. */
	finish(): void {
		this.floor = 1;
		this.easing = false;
	}

	/** Raises the floor that counted work sets, which the bar never falls below. */
	private raise(share: number): void {
		const next = Math.min(ALMOST, Math.max(0, share));
		if (next <= this.floor) return;
		this.floor = next;
		if (this.easing && this.floor >= this.ceiling) this.easing = false;
	}

	/** Starts a stretch of uncounted work that eases from where the bar is toward `ceiling`. */
	private easeTo(ceiling: number, now: number): void {
		const current = Math.max(this.floor, this.value(now));
		const next = Math.min(ALMOST, Math.max(ceiling, current));
		// A stretch that already eases at least this far keeps its course.
		if (this.easing && next <= this.ceiling) return;
		this.from = current;
		this.ceiling = next;
		this.at = now;
		this.easing = next - current > 0.005;
	}
}

/**
 * The figures that a phase's bar shows, rounded to whole percent and never below the last of the
 * same phase. A scene's total grows as it starts more files, so a fraction taken from the bytes so
 * far can fall while the work goes on; the bar's percentage holds instead. A new phase starts a
 * measure of its own.
 */
export class LoadMeter {
	private key = '';
	private percent = -1;

	/** The phase's figures as its bar shows them. */
	show(phase: LoadPhase): LoadPhase {
		if (phase.key !== this.key) {
			this.key = phase.key;
			this.percent = -1;
		}
		if (phase.value === undefined || !Number.isFinite(phase.value))
			return { ...phase, value: undefined };
		const percent = Math.round(Math.min(1, Math.max(0, phase.value)) * 100);
		this.percent = Math.max(this.percent, percent);
		return { ...phase, value: this.percent / 100 };
	}
}

/**
 * Tells the page's loading overlay how many of the scene's file bytes have arrived. The total is
 * the length of each response that announced one, so it grows as the scene starts more files. A
 * response with no length adds its bytes to what arrived but to no total, so a scene of such files
 * posts a count without a fraction, and the card holds its bar moving.
 */
export function reportLoading(ctx: SketchContext): void {
	ctx.assets.onProgress((loaded, total) => {
		const expected = Math.max(total, loaded);
		const message: { text: string; detail: string; kind: 'files'; value?: number } = {
			text: 'Downloading scene files',
			// The downloads run beside the scene's own milestones, so the overlay keeps their bar in
			// a lane of its own while the scene names what it is building.
			kind: 'files',
			detail:
				total > 0 ? `${bytesOf(loaded)} of ${bytesOf(expected)}` : `${bytesOf(loaded)} so far`,
		};
		if (total > 0) message.value = loaded / expected;
		ctx.page.post('loading', message);
	});
}

/** A byte count as a loading card shows it. */
export function bytesOf(count: number): string {
	if (count < 1024) return `${count} B`;
	if (count < 1024 * 1024) return `${Math.round(count / 1024)} KB`;
	return `${(count / (1024 * 1024)).toFixed(1)} MB`;
}
