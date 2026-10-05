// What an engine holds on the page that the next engine may need: the canvas, and the page's copy
// of the core when the sketch runs on the page. A new engine waits for the one that holds such a
// thing when that engine is stopping, or still starting, as React's StrictMode does when it starts,
// destroys and starts again an effect's engine on one canvas. It fails at once only when the holder
// runs on. A canvas that an engine moved to a worker can never come back to the page, so when that
// engine stops, its drawing worker stays with the canvas, without the engine's core or GPU device,
// and the next engine on the canvas draws through it. The worker stays only while the canvas is in
// the document: one that leaves it, or that the browser collects, takes the worker with it, so a
// page that drops its canvases keeps no idle workers.

/** An engine's hold on a canvas or on the page's core, from its start until it has stopped. */
export class Holder {
	private stoppingNow = false;
	private settle: () => void = () => {};
	private markStopped: () => void = () => {};
	/** Settles once the engine's start has resolved or failed. */
	readonly settled = new Promise<void>((resolve) => {
		this.settle = resolve;
	});
	/** Resolves once the engine has stopped and let go of what it held. */
	readonly stopped = new Promise<void>((resolve) => {
		this.markStopped = resolve;
	});

	/** True once the engine has begun to stop. */
	get stopping(): boolean {
		return this.stoppingNow;
	}

	/** The engine's start has resolved or failed. */
	startSettled(): void {
		this.settle();
	}

	/** The engine has begun to stop. */
	beginStop(): void {
		this.stoppingNow = true;
	}

	/** The engine has stopped and let go. */
	endStop(): void {
		this.stoppingNow = true;
		this.settle();
		this.markStopped();
	}
}

/** Resolves after the tasks queued now have run, such as the handlers of a start that settled. */
function laterTask(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Waits until `current()` holds nothing, then calls `take()` at once, in the same task, so no other
 * start that waits takes it first. A holder whose start settles while it runs on, with no stop
 * begun in the handlers of that start, makes the wait fail with `refuse()`'s error. A start that is
 * still going counts as not yet settled, so the wait goes on.
 */
export async function takeWhenFree(
	current: () => Holder | undefined,
	take: () => void,
	refuse: () => Error,
): Promise<void> {
	for (;;) {
		const holder = current();
		if (!holder) {
			take();
			return;
		}
		if (!holder.stopping) {
			await holder.settled;
			// The start's own handlers, such as a cleanup that destroys the engine it got, run first.
			await laterTask();
			if (!holder.stopping) throw refuse();
		}
		await holder.stopped;
	}
}

/** The thread that draws on a canvas, as the canvas's hold records it. */
export type DrawingRole = 'render' | 'sketch';

/** What the page knows about a canvas that an engine drew on. */
export interface CanvasHold {
	/** The engine that holds the canvas now. */
	holder: Holder | undefined;
	/**
	 * The worker that kept the canvas when the engine that moved it there stopped, and the role it
	 * draws in. The next engine on the canvas takes it over.
	 */
	parked: { worker: Worker; role: DrawingRole } | undefined;
	/** The role of the worker that holds the canvas, once an engine moved it to a worker. */
	movedTo: DrawingRole | undefined;
	/** True once the page drew on the canvas: it has a context, so it can never move to a worker. */
	pageContext: boolean;
	/** The reason no engine can draw on the canvas again, after its drawing worker failed. */
	dead: string | undefined;
	/** True once an engine fixed the canvas's CSS size, which only a fresh canvas needs. */
	sized: boolean;
}

const holds = new WeakMap<HTMLCanvasElement, CanvasHold>();

/** Stops a parked worker once the browser has collected the canvas that it kept. */
const parkedWorkers = new FinalizationRegistry<Worker>((worker) => worker.terminate());

/** The page's record of a canvas, made on first use. */
export function canvasHold(canvas: HTMLCanvasElement): CanvasHold {
	let hold = holds.get(canvas);
	if (!hold) {
		hold = {
			holder: undefined,
			parked: undefined,
			movedTo: undefined,
			pageContext: false,
			dead: undefined,
			sized: false,
		};
		holds.set(canvas, hold);
	}
	return hold;
}

/** The canvases whose parked workers stay while each canvas is in the document. */
const parkedCanvases = new Set<HTMLCanvasElement>();
/** Watches the document for parked canvases that leave it, while any is parked. */
let removals: MutationObserver | undefined;

/** Stops a parked worker for good: no engine draws on its canvas again. */
function endParked(canvas: HTMLCanvasElement, hold: CanvasHold): void {
	const parked = hold.parked;
	if (!parked) return;
	hold.parked = undefined;
	parkedWorkers.unregister(hold);
	parkedCanvases.delete(canvas);
	parked.worker.terminate();
	hold.dead = `its ${parked.role} worker stopped when the canvas left the page`;
}

/** Ends the parked workers whose canvases left the document. */
function checkRemovals(): void {
	for (const canvas of [...parkedCanvases])
		if (!canvas.isConnected) endParked(canvas, canvasHold(canvas));
	if (parkedCanvases.size === 0) {
		removals?.disconnect();
		removals = undefined;
	}
}

/**
 * Keeps a drawing worker with its canvas until the next engine takes it, the canvas leaves the
 * document, or the browser collects the canvas.
 */
export function parkWorker(
	canvas: HTMLCanvasElement,
	hold: CanvasHold,
	worker: Worker,
	role: DrawingRole,
): void {
	hold.parked = { worker, role };
	parkedWorkers.register(canvas, worker, hold);
	parkedCanvases.add(canvas);
	if (!canvas.isConnected) {
		endParked(canvas, hold);
		return;
	}
	if (!removals && typeof MutationObserver === 'function') {
		removals = new MutationObserver(checkRemovals);
		removals.observe(document, { childList: true, subtree: true });
	}
}

/** Takes the parked drawing worker of a canvas for a new engine, if one waits. */
export function takeParkedWorker(canvas: HTMLCanvasElement, hold: CanvasHold): Worker | undefined {
	const parked = hold.parked;
	if (!parked) return undefined;
	hold.parked = undefined;
	parkedWorkers.unregister(hold);
	parkedCanvases.delete(canvas);
	return parked.worker;
}
