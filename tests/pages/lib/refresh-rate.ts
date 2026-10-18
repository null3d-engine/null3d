// Measures the display's refresh rate in a page, from the intervals between animation frames. The
// runner page measures with it, and the timing tools on the Mac pass it to a page through
// Playwright's `evaluate`, so the function uses nothing from outside its own body.

/** How a page measures the display's refresh rate. */
export interface RefreshMeasure {
	/** The frames timed after the warm-up; the median interval between them gives the rate. */
	samples: number;
	/**
	 * How long the page changes the screen before it times frames. A phone lowers its display's rate
	 * while the screen barely changes, and the Galaxy S24+ took about 330 ms to raise it again once
	 * every frame changed the screen.
	 */
	warmUpMs: number;
	/**
	 * How long the page waits for the frames. A visible page gets them within about a second; a page
	 * that the browser hides gets none until it shows it.
	 */
	limitMs: number;
	/**
	 * A background one shade off the page's own, which the measured element takes on every other
	 * frame, so each frame changes the screen unseen.
	 */
	shade: string;
	/** The id of the element whose background changes, or the whole page without one. */
	element?: string;
}

/** The measurement that the runner page and the timing tools make. */
export const REFRESH_MEASURE: RefreshMeasure = {
	samples: 61,
	warmUpMs: 500,
	limitMs: 20_000,
	shade: '#101419',
};

/** The parts of a page that the measurement uses. */
interface FramePage {
	document: {
		documentElement: { style: { backgroundColor: string } };
		getElementById(id: string): { style: { backgroundColor: string } } | null;
	};
	requestAnimationFrame(callback: (time: number) => void): number;
}

/**
 * The display's refresh rate in hertz, from the median interval between animation frames, or null
 * when the browser gives the page too few frames within the time limit. Frame callbacks follow the
 * display's rate, and a phone lowers that rate while the screen barely changes, as when only the
 * runner page's report changes between pages: the Galaxy S24+ then runs at 24 Hz. So each frame of
 * the measurement changes a background by one shade, and the timing starts once the display has
 * had time to rise to its full rate.
 */
export async function refreshRate({
	samples,
	warmUpMs,
	limitMs,
	shade,
	element,
}: RefreshMeasure): Promise<number | null> {
	const page = globalThis as unknown as FramePage;
	const target =
		(element && page.document.getElementById(element)) || page.document.documentElement;
	const times: number[] = [];
	let frames = 0;
	let warmUpEnd = Number.POSITIVE_INFINITY;
	let late = false;
	const measured = await new Promise<boolean>((resolve) => {
		const limit = setTimeout(() => {
			late = true;
			resolve(false);
		}, limitMs);
		const tick = (time: number) => {
			if (late) return;
			target.style.backgroundColor = frames++ % 2 === 0 ? shade : '';
			if (frames === 1) warmUpEnd = time + warmUpMs;
			if (time >= warmUpEnd) times.push(time);
			if (times.length < samples) page.requestAnimationFrame(tick);
			else {
				clearTimeout(limit);
				resolve(true);
			}
		};
		page.requestAnimationFrame(tick);
	});
	target.style.backgroundColor = '';
	if (!measured) return null;
	const intervals = times
		.slice(1)
		.map((time, i) => time - (times[i] as number))
		.sort((a, b) => a - b);
	return Math.round(1000 / (intervals[Math.floor(intervals.length / 2)] as number));
}
