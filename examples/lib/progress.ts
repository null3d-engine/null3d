// The loading progress that a scene posts to the page's loading overlay, and the model that the
// overlay keeps for the percentage it shows. A scene that loads files posts the bytes that have
// arrived, against the bytes that the files announced. A scene that builds without files names the
// phase it is in, and the overlay holds its bar moving while it waits. `examples/lib/run.ts` draws
// both, and the engine's own start stages beside them.
import type { SketchContext } from '@null3d/engine';

/** What a loading card shows for one phase of a start. */
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
 * The figures that a card shows for each phase, rounded to whole percent and never below the last
 * of the same phase. A scene's total grows as it starts more files, so a fraction taken from the
 * bytes so far can fall while the work goes on; the card's percentage holds instead. A new phase
 * starts a measure of its own.
 */
export class LoadMeter {
	private key = '';
	private percent = -1;

	/** The phase's figures as the card shows them. */
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
		const message: { text: string; detail: string; value?: number } = {
			text: 'Downloading scene files',
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
