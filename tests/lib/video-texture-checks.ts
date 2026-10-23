// What a run of the video texture page reports, and what a run must show. The page plays a canvas
// as a video into a texture in the sketch, so its frames have the colours that it paints: the
// video's frames arrive while it plays and stay within the preset's upload budget, a paused video
// uploads nothing, and the frame's colour matches the same colour made from data.

/** One measured window of the page: its uploads a frame, and the frames that it drew. */
export interface VideoWindow {
	mean: number;
	p99: number;
	frames: number;
}

/** What the video texture page reports. */
export interface VideoTextureResult {
	/** The preset's upload budget, in bytes a frame. */
	budget: number;
	/** The video's size, which is 0 when the browser played none. */
	width: number;
	height: number;
	/** The window while the video played, and the one while it was paused. */
	playing: VideoWindow;
	paused: VideoWindow;
	/** The colour of the video's half of the frame, and of the data texture's half. */
	left: readonly number[];
	right: readonly number[];
	/** The largest difference of one channel between the two halves. */
	off: number;
	withinTolerance: boolean;
}

const rgb = (color: readonly number[] | undefined) => `rgb(${(color ?? []).join(', ')})`;
const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;

/** What is wrong with a run of the video texture page, in words. Empty when it passed. */
export function videoTextureProblems(result: VideoTextureResult): string[] {
	const problems: string[] = [];
	const { playing, paused, budget } = result;
	if (!(result.width > 0 && result.height > 0))
		problems.push('the browser played no video: its size stayed 0 x 0');
	if (!(playing.p99 > 0)) problems.push('the video sent the texture no frame while it played');
	else if (playing.p99 > budget)
		problems.push(
			`a frame uploaded ${kib(playing.p99)}, over the ${kib(budget)} that one frame may upload`,
		);
	if (paused.p99 > 0)
		problems.push(`the texture uploaded ${paused.p99} bytes in a frame while its video was paused`);
	if (!result.withinTolerance)
		problems.push(
			`the video's half of the frame shows ${rgb(result.left)}, not the ${rgb(result.right)} that the same colour shows from data`,
		);
	return problems;
}

/** The figures of a run, for the run's notes. */
export function videoTextureNote(result: VideoTextureResult): string {
	const { playing, paused, budget } = result;
	return `the video's frames: ${kib(playing.mean)} a frame on average, ${kib(playing.p99)} at p99 of a budget of ${kib(budget)}; paused: ${paused.p99} bytes at p99; the video's half shows ${rgb(result.left)} against ${rgb(result.right)} from data`;
}
