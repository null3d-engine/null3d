// The deterministic simulation demo's play, without the page: the live run, its log, a replay of
// the log, the replay's verdict, the clock that turns frames into ticks, and the view that the page
// sends the sketch. Live play logs a tick's input and steps the run by it, and a replay steps a new
// run from the seed through the same log with the same call. The page part owns the input, the
// buttons and the frame loop.
import { INPUT_NUMBERS, ORBS, type Run, sameRun, startRun, stepLogged, TICK_HZ } from './sim';
import { BEFORE, BETWEEN, CAUGHT, NOW, VIEW_NUMBERS } from './view';

const TICK_MS = 1000 / TICK_HZ;
/** The most time that one frame steps, so a page that was hidden does not race to catch up. */
const MOST_MS = 250;
/** How long the replay's verdict shows, in ticks of the run that goes on after it. */
const VERDICT_TICKS = 4 * TICK_HZ;

/** Writes a run's pose, its eye and its view's rotation, into the view from `at`. */
function writePose(view: Float64Array, at: number, run: Run): void {
	view.set(run.position, at);
	view.set(run.look, at + 3);
}

/** The ticks that frames step, from the frames' timestamps. */
export class TickClock {
	private carry = 0;

	constructor(private last: number) {}

	/**
	 * The ticks due at a frame's timestamp `now`. A frame's timestamp can come before the time that
	 * the clock started from, and that counts as no time.
	 */
	due(now: number): number {
		this.carry = Math.min(Math.max(this.carry + now - this.last, 0), MOST_MS);
		this.last = now;
		const ticks = Math.floor(this.carry / TICK_MS);
		this.carry -= ticks * TICK_MS;
		return ticks;
	}

	/** How far the frame is from the last tick to the next, from 0 to 1. */
	get between(): number {
		return this.carry / TICK_MS;
	}
}

/**
 * The input that the page gathered since the last tick: the movement keys' bits, and the mouse's
 * turn and tilt in CSS pixels, whose fractions wait for a later tick.
 */
export interface Gathered {
	keys: number;
	turn: number;
	tilt: number;
}

/** A session's play: the live run, its log, a replay of it, and the replay's verdict. */
interface Play {
	run: Run;
	log: number[];
	replaying: Run | undefined;
	verdict: string;
	/** The live run's tick until which the verdict shows. */
	verdictUntil: number;
}

/** A new play: a run from the seed, with an empty log, no replay and no verdict. */
function freshPlay(): Play {
	return { run: startRun(), log: [], replaying: undefined, verdict: '', verdictUntil: 0 };
}

/** The live run, its log and its replay, and the view that the sketch draws them from. */
export class Session {
	/** The numbers that the page sends the sketch, as `view.ts` lays them out. */
	readonly view = new Float64Array(VIEW_NUMBERS);
	private play = freshPlay();

	constructor() {
		this.showStart();
	}

	/** True while a replay runs. */
	get replays(): boolean {
		return this.play.replaying !== undefined;
	}

	/** A new run from the seed, with an empty log and no verdict. */
	restart(): void {
		this.play = freshPlay();
		this.showStart();
	}

	/** Puts the run's start in both poses, so a frame between them draws the start. */
	private showStart(): void {
		writePose(this.view, BEFORE, this.play.run);
		writePose(this.view, NOW, this.play.run);
	}

	/** Starts a replay of the log from the seed. Returns false while one runs or the log is empty. */
	replay(): boolean {
		if (this.play.replaying || this.play.log.length === 0) return false;
		this.play.replaying = startRun();
		return true;
	}

	/**
	 * Steps the ticks that a frame owes. A live tick takes the whole counts of the gathered movement
	 * and leaves the fractions. A replay's tick takes none, and drops the movement that came while
	 * the replay ran, the tick where it ends included, so none of it reaches the live run after it.
	 */
	steps(due: number, gathered: Gathered): void {
		for (let k = 0; k < due; k++) {
			if (this.play.replaying) {
				this.tick(0, 0, 0);
				gathered.turn = 0;
				gathered.tilt = 0;
				continue;
			}
			const turn = Math.trunc(gathered.turn);
			const tilt = Math.trunc(gathered.tilt);
			gathered.turn -= turn;
			gathered.tilt -= tilt;
			this.tick(gathered.keys, turn, tilt);
		}
	}

	/**
	 * One tick. The live run logs the tick's input, the movement keys' bits and the mouse's turn
	 * and tilt in whole counts, and steps by it. A replay steps by the log's next tick instead, and
	 * ends with a verdict on whether it reached the run's state.
	 */
	tick(keys: number, turn: number, tilt: number): void {
		writePose(this.view, BEFORE, this.play.replaying ?? this.play.run);
		if (this.play.replaying) {
			stepLogged(this.play.replaying, this.play.log);
			if (this.play.replaying.tick * INPUT_NUMBERS >= this.play.log.length) {
				// The replay ran every logged tick from the seed: its state is the run's, bit for bit.
				this.play.verdict = sameRun(this.play.replaying, this.play.run)
					? 'Replay ended on the same state'
					: 'Replay ended on another state';
				this.play.verdictUntil = this.play.run.tick + VERDICT_TICKS;
				this.play.replaying = undefined;
			}
		} else {
			this.play.log.push(keys, turn, tilt);
			stepLogged(this.play.run, this.play.log);
		}
		writePose(this.view, NOW, this.play.replaying ?? this.play.run);
	}

	/** The view for a frame `between` the last two ticks, with the orbs that the shown run caught. */
	frame(between: number): Float64Array {
		const shown = this.play.replaying ?? this.play.run;
		let caught = 0;
		for (let i = 0; i < ORBS; i++) if ((shown.caught[i] as number) >= 0) caught |= 1 << i;
		this.view[BETWEEN] = between;
		this.view[CAUGHT] = caught;
		return this.view;
	}

	/** The line that the page shows: the replay's progress, its verdict for a while, or the score. */
	status(): string {
		const seconds = (ticks: number) => (ticks / TICK_HZ).toFixed(1);
		if (this.play.replaying) {
			const total = this.play.log.length / INPUT_NUMBERS;
			return `Replaying ${seconds(this.play.replaying.tick)} of ${seconds(total)} s`;
		}
		if (this.play.run.tick < this.play.verdictUntil) return this.play.verdict;
		return `${this.play.run.score} of ${ORBS} orbs`;
	}
}
