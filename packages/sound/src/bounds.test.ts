import { describe, expect, test } from 'bun:test';
import { gaplessBounds, mp3Gapless, soundBounds } from './bounds';

/**
 * The first frame of an MP3 file, as an encoder writes it: an MPEG 1 Layer III header at 48 kHz, its
 * side information, a Xing tag with the frame count, and a LAME extension with the delay and the
 * padding, behind an ID3v2 tag when `id3` is given.
 */
function mp3Head(options: {
	frames: number;
	delay: number;
	padding: number;
	encoder?: string;
	mono?: boolean;
	id3?: number;
}): ArrayBuffer {
	const { frames, delay, padding, encoder = 'Lavc', mono = false, id3 = 0 } = options;
	const bytes: number[] = [];
	if (id3 > 0) {
		bytes.push(0x49, 0x44, 0x33, 4, 0, 0);
		bytes.push((id3 >> 21) & 0x7f, (id3 >> 14) & 0x7f, (id3 >> 7) & 0x7f, id3 & 0x7f);
		for (let k = 0; k < id3; k++) bytes.push(0);
	}
	// Sync, MPEG 1, Layer III, no CRC; 128 kbps, 48 kHz; stereo or mono.
	bytes.push(0xff, 0xfb, 0x94, mono ? 0xc0 : 0x00);
	for (let k = 0; k < (mono ? 17 : 32); k++) bytes.push(0);
	bytes.push(...[...'Xing'].map((c) => c.charCodeAt(0)), 0, 0, 0, 1);
	bytes.push((frames >>> 24) & 0xff, (frames >>> 16) & 0xff, (frames >>> 8) & 0xff, frames & 0xff);
	const name = `${encoder}3.100`.slice(0, 9).padEnd(9, ' ');
	bytes.push(...[...name].map((c) => c.charCodeAt(0)));
	for (let k = 0; k < 12; k++) bytes.push(0);
	bytes.push(delay >> 4, ((delay & 0x0f) << 4) | (padding >> 8), padding & 0xff);
	for (let k = 0; k < 64; k++) bytes.push(0);
	return new Uint8Array(bytes).buffer;
}

describe('mp3Gapless', () => {
	test("reads the delay and padding of a file from ffmpeg's encoder", () => {
		const header = mp3Gapless(mp3Head({ frames: 251, delay: 576, padding: 576, mono: true }));
		expect(header).toEqual({ start: 576, end: 576, length: 288_000, sampleRate: 48_000 });
	});

	test("adds the decoder's delay to a LAME file's, past an ID3 tag", () => {
		const header = mp3Gapless(
			mp3Head({ frames: 100, delay: 576, padding: 1000, encoder: 'LAME', id3: 300 }),
		);
		expect(header).toEqual({ start: 1105, end: 471, length: 113_624, sampleRate: 48_000 });
	});

	test('reads nothing from a file without the header', () => {
		const wav = new TextEncoder().encode('RIFF....WAVEfmt ').buffer as ArrayBuffer;
		expect(mp3Gapless(wav)).toBeNull();
	});
});

describe('gaplessBounds', () => {
	const header = { start: 576, end: 576, length: 288_000, sampleRate: 48_000 };

	test('trims nothing from a browser that read the header', () => {
		expect(gaplessBounds(header, 288_000, 48_000)).toEqual({ start: 0, end: 6 });
	});

	test('drops the delay and the padding that a browser kept', () => {
		// WebKit decodes the hover loop to 289,152 samples, with 576 kept at each end.
		const bounds = gaplessBounds(header, 289_152, 48_000);
		expect(bounds?.start).toBeCloseTo(0.012, 9);
		expect(bounds?.end).toBeCloseTo(6.012, 9);
	});

	test('works in the decoded rate when the browser resamples', () => {
		const bounds = gaplessBounds(header, Math.round(289_152 * (44_100 / 48_000)), 44_100);
		expect(bounds?.start).toBeCloseTo(0.012, 4);
		expect(bounds?.end).toBeCloseTo(6.012, 3);
	});

	test('gives up on a length that fits neither case', () => {
		expect(gaplessBounds(header, 280_000, 48_000)).toBeNull();
		expect(gaplessBounds(header, 300_000, 48_000)).toBeNull();
	});
});

describe('soundBounds', () => {
	test('skips the silence at both ends of a file', () => {
		const channel = new Float32Array(10_000);
		for (let i = 1105; i < 10_000 - 600; i++) channel[i] = Math.sin(i * 0.1) * 0.5 + 0.6;
		const { start, end } = soundBounds([channel], 1000);
		expect(start).toBe(1.105);
		expect(end).toBe(9.4);
	});

	test('takes sound in any channel', () => {
		const left = new Float32Array(100);
		const right = new Float32Array(100);
		right[3] = 0.5;
		right[90] = 0.5;
		expect(soundBounds([left, right], 100)).toEqual({ start: 0.03, end: 0.91 });
	});

	test('cuts no more than the most silence it allows', () => {
		const silent = new Float32Array(10_000);
		const { start } = soundBounds([silent], 1000);
		expect(start).toBe(2.048);
	});
});
