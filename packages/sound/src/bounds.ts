// The part of a decoded file that holds sound. MP3 and AAC encoders add a little silence at each end
// of a file, which some browsers keep after decoding, so a loop that played the whole file would
// pause at its join.

/**
 * The level below which a sample at a file's start or end is the codec's padding. A loop's own sound
 * never falls this low, so the loop skips the padding and joins its ends with no gap.
 */
const PADDING_LEVEL = 1e-4;
/** The most samples of padding that a file's start or end may hold. */
const PADDING_MOST = 2048;
/** The part of a decoded file past its codec's padding at either end. */
export function soundBounds(
	channels: readonly Float32Array[],
	sampleRate: number,
): {
	start: number;
	end: number;
} {
	const length = channels[0]?.length ?? 0;
	const loud = (i: number) =>
		channels.some((channel) => Math.abs(channel[i] as number) > PADDING_LEVEL);
	let first = 0;
	while (first < Math.min(PADDING_MOST, length - 1) && !loud(first)) first++;
	let last = length - 1;
	while (last > Math.max(first, length - 1 - PADDING_MOST) && !loud(last)) last--;
	return { start: first / sampleRate, end: (last + 1) / sampleRate };
}
