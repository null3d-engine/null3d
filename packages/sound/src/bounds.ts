// The part of a decoded file that holds sound. MP3 encoders add samples at each end of a file: the
// encoder's delay at the start and padding at the end, which a header in the file's first frame
// records. A browser that reads that header drops them as it decodes; one that does not keeps them,
// and a loop that played them would dip at each join. So the page reads the header itself and drops
// what the browser kept. A file with no such header loses only the near-silence at its ends.

/**
 * The level below which a sample at a file's start or end is silence. A loop's own sound never falls
 * this low, so the loop skips such samples and joins its ends with no gap.
 */
const PADDING_LEVEL = 1e-4;
/** The most samples of silence that the fallback cuts from a file's start or end. */
const PADDING_MOST = 2048;
/**
 * The delay of an MP3 decoder, in samples, which a file from the LAME encoder leaves out of the
 * delay that its header records. ffmpeg's encoder counts the whole delay in the header.
 */
const LAME_DECODER_DELAY = 529;

/** What an MP3 file's gapless header records. */
export interface Mp3Gapless {
	/** The samples of encoder delay to drop at the start, the decoder's own delay included. */
	readonly start: number;
	/** The samples of padding to drop at the end. */
	readonly end: number;
	/** The samples that the file holds without its delay and padding. */
	readonly length: number;
	/** The file's sample rate. */
	readonly sampleRate: number;
}

/** The MPEG audio sample rates by version bits and rate index: MPEG 1, MPEG 2 and MPEG 2.5. */
const RATES: Readonly<Record<number, readonly number[]>> = {
	3: [44_100, 48_000, 32_000],
	2: [22_050, 24_000, 16_000],
	0: [11_025, 12_000, 8_000],
};

/**
 * Reads the gapless header of an MP3 file: the Xing or Info frame with its frame count and the LAME
 * extension with the delay and the padding. Returns null for a file without one, such as a WAV or
 * an MP3 from an encoder that writes no LAME extension.
 */
export function mp3Gapless(bytes: ArrayBuffer): Mp3Gapless | null {
	const data = new Uint8Array(bytes);
	const at = (i: number) => data[i] ?? 0;
	let i = 0;
	// An ID3v2 tag comes first, with a size of four 7-bit bytes, and a footer when its flag says so.
	if (at(0) === 0x49 && at(1) === 0x44 && at(2) === 0x33) {
		const size = (at(6) << 21) | (at(7) << 14) | (at(8) << 7) | at(9);
		i = 10 + size + (at(5) & 0x10 ? 10 : 0);
	}
	// The first frame's header starts with eleven set bits.
	const scanTo = Math.min(data.length - 4, i + 4096);
	while (i < scanTo && !(at(i) === 0xff && (at(i + 1) & 0xe0) === 0xe0)) i++;
	if (i >= scanTo) return null;
	const version = (at(i + 1) >> 3) & 3;
	const layer = (at(i + 1) >> 1) & 3;
	const rates = RATES[version];
	const sampleRate = rates?.[(at(i + 2) >> 2) & 3];
	// Layer III only, the layer of every MP3 file.
	if (layer !== 1 || sampleRate === undefined) return null;
	const mpeg1 = version === 3;
	const mono = ((at(i + 3) >> 6) & 3) === 3;
	const side = mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17;
	let p = i + 4 + side;
	const tag = String.fromCharCode(at(p), at(p + 1), at(p + 2), at(p + 3));
	if (tag !== 'Xing' && tag !== 'Info') return null;
	const flags = (at(p + 4) << 24) | (at(p + 5) << 16) | (at(p + 6) << 8) | at(p + 7);
	p += 8;
	if (!(flags & 1)) return null;
	const frames = ((at(p) << 24) | (at(p + 1) << 16) | (at(p + 2) << 8) | at(p + 3)) >>> 0;
	p += 4;
	if (flags & 2) p += 4;
	if (flags & 4) p += 100;
	if (flags & 8) p += 4;
	// The LAME extension: nine bytes that name the encoder, then its fields, with the delay and the
	// padding as two 12-bit numbers 21 bytes in.
	if (p + 24 > data.length) return null;
	const encoder = String.fromCharCode(...data.subarray(p, p + 4));
	const delay = (at(p + 21) << 4) | (at(p + 22) >> 4);
	const padding = ((at(p + 22) & 0x0f) << 8) | at(p + 23);
	const frameSamples = mpeg1 ? 1152 : 576;
	const length = frames * frameSamples - delay - padding;
	if (frames === 0 || length <= 0) return null;
	const decoder = encoder === 'LAME' ? LAME_DECODER_DELAY : 0;
	return { start: delay + decoder, end: Math.max(0, padding - decoder), length, sampleRate };
}

/**
 * The part of a decoded file that holds sound, in seconds, from what its gapless header records. A
 * browser that read the header decoded the file's own length, and loses nothing more. One that kept
 * the delay and the padding decoded more: the excess goes, the delay's share from the start and the
 * rest from the end. Returns null when the decoded length fits neither case.
 */
export function gaplessBounds(
	header: Mp3Gapless,
	decodedLength: number,
	decodedRate: number,
): { start: number; end: number } | null {
	const scale = decodedRate / header.sampleRate;
	const excess = decodedLength / scale - header.length;
	const seconds = decodedLength / decodedRate;
	if (Math.abs(excess) < 2) return { start: 0, end: seconds };
	if (excess < 0 || excess > header.start + header.end + 2) return null;
	const start = Math.min(excess, header.start);
	return { start: start / header.sampleRate, end: seconds - (excess - start) / header.sampleRate };
}

/** The part of a decoded file past the near-silence at either end, in seconds. */
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
