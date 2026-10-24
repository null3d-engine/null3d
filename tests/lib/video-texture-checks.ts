// What a run of the video texture page reports, and what a run must show. The page plays a canvas
// as a video into a texture in the sketch, so its frames have the colours that it paints: the
// video's frames arrive while it plays and stay within the preset's upload budget, a paused video
// uploads nothing, the frame takes the size that the options give it, and the picture is the right
// way up, with its colours as the page painted them.

/** One measured window of the page: its uploads a frame, and the frames that it drew. */
export interface VideoWindow {
	mean: number;
	p99: number;
	frames: number;
}

/** One colour that the frame shows, from the video's half and from the data texture's half. */
export interface VideoSample {
	/** Where the sample sits, such as "the top half". */
	readonly at: string;
	readonly video: readonly number[];
	readonly data: readonly number[];
}

/** What the video texture page reports. */
export interface VideoTextureResult {
	/** The preset's upload budget, in bytes a frame. */
	budget: number;
	/** The video's size, which is 0 when the browser played none. */
	width: number;
	height: number;
	/** The most texels of a frame's widest side that the page sends. */
	maxSize: number;
	/** The texture's size once its first frame is on the GPU, or 1 x 1 before any. */
	frame: { width: number; height: number };
	/** True when the browser played the video. */
	played: boolean;
	/** The page's cost of a frame: the time that copying and scaling the video takes its thread. */
	copy: { count: number; medianMs: number; p95Ms: number };
	/** The window while the video played, and the one while it was paused. */
	playing: VideoWindow;
	paused: VideoWindow;
	/** The colours of the frame: the video's half beside the data texture's half. */
	samples: readonly VideoSample[];
}

/** How far one channel of the video's half may sit from the same channel of the data's half. */
export const VIDEO_TOLERANCE = 24;

/** The largest difference of one channel between two colours. */
function channelGap(a: readonly number[], b: readonly number[]): number {
	let gap = 0;
	for (let channel = 0; channel < 3; channel++)
		gap = Math.max(gap, Math.abs((a[channel] ?? 0) - (b[channel] ?? 0)));
	return gap;
}

const rgb = (color: readonly number[] | undefined) => `rgb(${(color ?? []).join(', ')})`;
const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;

/** What is wrong with a run of the video texture page, in words. Empty when it passed. */
export function videoTextureProblems(result: VideoTextureResult): string[] {
	const problems: string[] = [];
	const { playing, paused, budget, frame, width, height } = result;
	if (!result.played) problems.push('the browser did not play the video');
	if (!(width > 0 && height > 0))
		problems.push('the browser played no video: its size stayed 0 x 0');
	if (!(playing.p99 > 0)) problems.push('the video sent the texture no frame while it played');
	else if (playing.p99 > budget)
		problems.push(
			`a frame uploaded ${kib(playing.p99)}, over the ${kib(budget)} that one frame may upload`,
		);
	if (paused.p99 > 0)
		problems.push(`the texture uploaded ${paused.p99} bytes in a frame while its video was paused`);
	if (playing.p99 > 0 && width > 0 && height > 0) {
		const widest = Math.max(frame.width, frame.height);
		const shape = frame.width / Math.max(1, frame.height);
		const videoShape = width / Math.max(1, height);
		if (widest > result.maxSize)
			problems.push(
				`the texture took ${frame.width} x ${frame.height} texels, past the ${result.maxSize} that a frame's widest side may take`,
			);
		else if (Math.abs(shape - videoShape) > 0.02)
			problems.push(
				`the texture took ${frame.width} x ${frame.height} texels, not the shape of the video's ${width} x ${height}`,
			);
	}
	for (const sample of result.samples) {
		if (channelGap(sample.video, sample.data) <= VIDEO_TOLERANCE) continue;
		problems.push(
			`the video's half shows ${rgb(sample.video)} at ${sample.at}, not the ${rgb(sample.data)} that the same colour shows from data`,
		);
	}
	return problems;
}

/** The figures of a run, for the run's notes. */
export function videoTextureNote(result: VideoTextureResult): string {
	const { playing, paused, budget, frame } = result;
	const gap = Math.max(0, ...result.samples.map(({ video, data }) => channelGap(video, data)));
	const colours = result.samples
		.map(({ at, video, data }) => `${at}: ${rgb(video)} against ${rgb(data)} from data`)
		.join('; ');
	return `the video's frames: ${kib(playing.mean)} a frame on average, ${kib(playing.p99)} at p99 of a budget of ${kib(budget)}; paused: ${paused.p99} bytes at p99; the page's copy of a frame: ${result.copy.medianMs.toFixed(2)} ms at the median, ${result.copy.p95Ms.toFixed(2)} ms at p95 of ${result.copy.count}; the texture is ${frame.width} x ${frame.height}; the colours are off by ${gap} of 255: ${colours}`;
}
