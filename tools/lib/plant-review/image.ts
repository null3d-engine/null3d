// Pictures for the plant review: RGBA images in memory, read through ffmpeg from a still, from a
// video at a time or as every frame of a video; laid on a plain colour by their alpha; resized by
// area; turned into CIELAB for colour distances;
// and drawn on, with filled boxes, other images and a small bitmap font, so a contact sheet carries
// its labels without a font file. The code is pure apart from the reads, which go through ffmpeg.
import { spawnSync } from 'node:child_process';

/** RGBA8 pixels, rows packed, top row first. */
export interface Rgba {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array;
}

/** An image of one colour. */
export function blank(width: number, height: number, colour: readonly number[]): Rgba {
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		data[i * 4] = colour[0] ?? 0;
		data[i * 4 + 1] = colour[1] ?? 0;
		data[i * 4 + 2] = colour[2] ?? 0;
		data[i * 4 + 3] = 255;
	}
	return { width, height, data };
}

/** Runs ffmpeg with `args` and returns its standard output, or throws with its message. */
function ffmpeg(args: readonly string[]): Buffer {
	const result = spawnSync('ffmpeg', ['-v', 'error', ...args], {
		maxBuffer: 1 << 30,
	});
	if (result.error) throw new Error(`ffmpeg could not start: ${result.error.message}. Install it.`);
	if (result.status !== 0)
		throw new Error(
			`ffmpeg failed: ${result.stderr.toString().trim() || `status ${result.status}`}`,
		);
	return result.stdout;
}

/** A video's size, its length in seconds and its frame rate, from ffprobe. */
export interface VideoFacts {
	readonly width: number;
	readonly height: number;
	readonly duration: number;
	readonly fps: number;
}

/** Reads a video's facts with ffprobe. */
export function probeVideo(path: string): VideoFacts {
	const result = spawnSync(
		'ffprobe',
		[
			'-v',
			'error',
			'-select_streams',
			'v:0',
			'-show_entries',
			'stream=width,height,r_frame_rate,duration',
			'-of',
			'json',
			path,
		],
		{ encoding: 'utf8' },
	);
	if (result.status !== 0) throw new Error(`ffprobe failed on ${path}: ${result.stderr.trim()}`);
	const stream = (
		JSON.parse(result.stdout) as {
			streams: { width: number; height: number; r_frame_rate: string; duration: string }[];
		}
	).streams[0];
	if (!stream) throw new Error(`${path} holds no video stream`);
	const [num = 0, den = 1] = stream.r_frame_rate.split('/').map(Number);
	return {
		width: stream.width,
		height: stream.height,
		duration: Number(stream.duration),
		fps: num / (den || 1),
	};
}

/** The frame of a video at a time in seconds, as RGBA. */
export function videoFrame(path: string, facts: VideoFacts, seconds: number): Rgba {
	const at = Math.max(0, Math.min(seconds, facts.duration - 0.5 / facts.fps));
	const data = ffmpeg([
		'-ss',
		at.toFixed(4),
		'-i',
		path,
		'-frames:v',
		'1',
		'-f',
		'rawvideo',
		'-pix_fmt',
		'rgba',
		'-',
	]);
	if (data.length !== facts.width * facts.height * 4)
		throw new Error(`ffmpeg gave ${data.length} bytes for the frame at ${at} s of ${path}`);
	return { width: facts.width, height: facts.height, data: new Uint8Array(data) };
}

/**
 * Every frame of a video, scaled to a width (its own when it is no wider), read in one ffmpeg run.
 * Frame k is at k over the frame rate seconds.
 */
export function videoFrames(path: string, facts: VideoFacts, width: number): Rgba[] {
	const w = Math.min(width, facts.width);
	// ffmpeg keeps an even height when it scales.
	const h = w === facts.width ? facts.height : 2 * Math.round((facts.height * w) / facts.width / 2);
	const data = ffmpeg([
		'-i',
		path,
		'-vf',
		`scale=${w}:${h}:flags=area`,
		'-f',
		'rawvideo',
		'-pix_fmt',
		'rgba',
		'-',
	]);
	const size = w * h * 4;
	const frames: Rgba[] = [];
	for (let at = 0; at + size <= data.length; at += size)
		frames.push({ width: w, height: h, data: new Uint8Array(data.subarray(at, at + size)) });
	if (frames.length === 0) throw new Error(`ffmpeg gave no frames of ${path}`);
	return frames;
}

/** A picture laid on a plain colour by its alpha, so a cut-out texture source reads as a still. */
export function onColour(image: Rgba, colour: readonly number[]): Rgba {
	const out = new Uint8Array(image.data.length);
	for (let i = 0; i < image.width * image.height; i++) {
		const a = (image.data[i * 4 + 3] as number) / 255;
		for (let c = 0; c < 3; c++)
			out[i * 4 + c] = Math.round(
				(image.data[i * 4 + c] as number) * a + (colour[c] as number) * (1 - a),
			);
		out[i * 4 + 3] = 255;
	}
	return { width: image.width, height: image.height, data: out };
}

/**
 * Reads a still through ffmpeg, which reads every PNG encoding and the other picture formats. The
 * PNG decoder the command-line tool ships misreads some of the reference stills without an error.
 */
export function readImage(path: string): Rgba {
	const probe = spawnSync(
		'ffprobe',
		['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
		{ encoding: 'utf8' },
	);
	const [width = 0, height = 0] = probe.stdout.trim().split(',').map(Number);
	if (!(width > 0 && height > 0))
		throw new Error(`ffprobe cannot read ${path}: ${probe.stderr.trim()}`);
	const data = ffmpeg(['-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
	if (data.length !== width * height * 4)
		throw new Error(`ffmpeg gave ${data.length} bytes for ${path}`);
	return { width, height, data: new Uint8Array(data) };
}

/** For each output pixel along one axis, the source pixels it covers and their weights. */
function axisWeights(from: number, to: number): { start: number; weights: number[] }[] {
	const scale = from / to;
	return Array.from({ length: to }, (_, i) => {
		if (scale <= 1) {
			// Enlarging: a linear blend of the two nearest source pixels.
			const centre = (i + 0.5) * scale - 0.5;
			const start = Math.max(0, Math.min(from - 1, Math.floor(centre)));
			const t = Math.max(0, Math.min(1, centre - start));
			return start + 1 < from ? { start, weights: [1 - t, t] } : { start, weights: [1] };
		}
		const left = i * scale;
		const right = left + scale;
		const start = Math.floor(left);
		const weights: number[] = [];
		for (let s = start; s < Math.min(from, Math.ceil(right)); s++)
			weights.push((Math.min(right, s + 1) - Math.max(left, s)) / scale);
		return { start, weights };
	});
}

/** An image resized to `width` by `height`, by area when it shrinks and linearly when it grows. */
export function resize(image: Rgba, width: number, height: number): Rgba {
	if (image.width === width && image.height === height) return image;
	const columns = axisWeights(image.width, width);
	const rows = axisWeights(image.height, height);
	const across = new Float32Array(width * image.height * 4);
	for (let y = 0; y < image.height; y++)
		for (let x = 0; x < width; x++) {
			const { start, weights } = columns[x] as { start: number; weights: number[] };
			for (let c = 0; c < 4; c++) {
				let sum = 0;
				for (let k = 0; k < weights.length; k++)
					sum +=
						(weights[k] as number) * (image.data[(y * image.width + start + k) * 4 + c] as number);
				across[(y * width + x) * 4 + c] = sum;
			}
		}
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const { start, weights } = rows[y] as { start: number; weights: number[] };
		for (let x = 0; x < width; x++)
			for (let c = 0; c < 4; c++) {
				let sum = 0;
				for (let k = 0; k < weights.length; k++)
					sum += (weights[k] as number) * (across[((start + k) * width + x) * 4 + c] as number);
				data[(y * width + x) * 4 + c] = Math.round(sum);
			}
	}
	return { width, height, data };
}

/** An image resized to a width, keeping its shape. */
export function resizeToWidth(image: Rgba, width: number): Rgba {
	return resize(image, width, Math.max(1, Math.round((image.height * width) / image.width)));
}

/** The linear value of one sRGB channel byte. */
function linear(byte: number): number {
	const c = byte / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A table of the linear value of each sRGB byte. */
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => linear(i));

/** The CIELAB colour (D65 white) of one sRGB colour. */
export function labOf(r: number, g: number, b: number): [number, number, number] {
	const lr = LINEAR[Math.round(r)] as number;
	const lg = LINEAR[Math.round(g)] as number;
	const lb = LINEAR[Math.round(b)] as number;
	const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
	const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
	const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
	const fx = f(x);
	const fy = f(y);
	const fz = f(z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Every pixel of an image as CIELAB, three numbers each. */
export function labImage(image: Rgba): Float32Array {
	const out = new Float32Array(image.width * image.height * 3);
	for (let i = 0; i < image.width * image.height; i++) {
		const [l, a, b] = labOf(
			image.data[i * 4] as number,
			image.data[i * 4 + 1] as number,
			image.data[i * 4 + 2] as number,
		);
		out[i * 3] = l;
		out[i * 3 + 1] = a;
		out[i * 3 + 2] = b;
	}
	return out;
}

/**
 * The sRGB byte of a linear value clamped between 0 and 1: the transfer that a display-encoded
 * canvas applies when it stores a blend made in linear light.
 *
 * @param value The linear value.
 * @returns The byte.
 */
export function srgbByte(value: number): number {
	const v = Math.max(0, Math.min(1, value));
	return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}

/** The sRGB bytes of a CIELAB colour, clamped to the gamut. */
export function srgbOf(lab: readonly number[]): [number, number, number] {
	const [l = 0, a = 0, b = 0] = lab;
	const fy = (l + 16) / 116;
	const fx = fy + a / 500;
	const fz = fy - b / 200;
	const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
	const x = inv(fx) * 0.95047;
	const y = inv(fy);
	const z = inv(fz) * 1.08883;
	const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
	const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
	const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
	return [srgbByte(lr), srgbByte(lg), srgbByte(lb)];
}

/** A colour as sRGB hex, such as #c9d9e6. */
export function hexOf(rgb: readonly number[]): string {
	return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** The plain distance between two CIELAB colours (CIE76). */
export function deltaE76(a: readonly number[], b: readonly number[]): number {
	return Math.hypot(
		(a[0] ?? 0) - (b[0] ?? 0),
		(a[1] ?? 0) - (b[1] ?? 0),
		(a[2] ?? 0) - (b[2] ?? 0),
	);
}

/** The perceptual distance between two CIELAB colours (CIEDE2000). About 2 is a visible step. */
export function deltaE2000(x: readonly number[], y: readonly number[]): number {
	const [l1 = 0, a1 = 0, b1 = 0] = x;
	const [l2 = 0, a2 = 0, b2 = 0] = y;
	const rad = Math.PI / 180;
	const c1 = Math.hypot(a1, b1);
	const c2 = Math.hypot(a2, b2);
	const cm = (c1 + c2) / 2;
	const g = 0.5 * (1 - Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7)));
	const ap1 = (1 + g) * a1;
	const ap2 = (1 + g) * a2;
	const cp1 = Math.hypot(ap1, b1);
	const cp2 = Math.hypot(ap2, b2);
	const hue = (b: number, a: number) => {
		if (a === 0 && b === 0) return 0;
		const h = Math.atan2(b, a) / rad;
		return h < 0 ? h + 360 : h;
	};
	const hp1 = hue(b1, ap1);
	const hp2 = hue(b2, ap2);
	const dl = l2 - l1;
	const dc = cp2 - cp1;
	let dh = 0;
	if (cp1 * cp2 !== 0) {
		dh = hp2 - hp1;
		if (dh > 180) dh -= 360;
		else if (dh < -180) dh += 360;
	}
	const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh * rad) / 2);
	const lm = (l1 + l2) / 2;
	const cpm = (cp1 + cp2) / 2;
	let hm = hp1 + hp2;
	if (cp1 * cp2 !== 0) {
		if (Math.abs(hp1 - hp2) > 180) hm += hm < 360 ? 360 : -360;
		hm /= 2;
	}
	const t =
		1 -
		0.17 * Math.cos((hm - 30) * rad) +
		0.24 * Math.cos(2 * hm * rad) +
		0.32 * Math.cos((3 * hm + 6) * rad) -
		0.2 * Math.cos((4 * hm - 63) * rad);
	const sl = 1 + (0.015 * (lm - 50) ** 2) / Math.sqrt(20 + (lm - 50) ** 2);
	const sc = 1 + 0.045 * cpm;
	const sh = 1 + 0.015 * cpm * t;
	const rt =
		-2 *
		Math.sqrt(cpm ** 7 / (cpm ** 7 + 25 ** 7)) *
		Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
	return Math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dH / sh) ** 2 + rt * (dc / sc) * (dH / sh));
}

/** Fills a box of an image with a colour, clipped to the image. */
export function fillBox(
	image: Rgba,
	x: number,
	y: number,
	width: number,
	height: number,
	colour: readonly number[],
): void {
	for (let row = Math.max(0, y); row < Math.min(image.height, y + height); row++)
		for (let col = Math.max(0, x); col < Math.min(image.width, x + width); col++) {
			const at = (row * image.width + col) * 4;
			image.data[at] = colour[0] ?? 0;
			image.data[at + 1] = colour[1] ?? 0;
			image.data[at + 2] = colour[2] ?? 0;
			image.data[at + 3] = 255;
		}
}

/** Copies an image onto another with its top left corner at (x, y), clipped. */
export function paste(onto: Rgba, image: Rgba, x: number, y: number): void {
	for (let row = 0; row < image.height; row++) {
		const ty = y + row;
		if (ty < 0 || ty >= onto.height) continue;
		for (let col = 0; col < image.width; col++) {
			const tx = x + col;
			if (tx < 0 || tx >= onto.width) continue;
			const from = (row * image.width + col) * 4;
			const to = (ty * onto.width + tx) * 4;
			onto.data[to] = image.data[from] as number;
			onto.data[to + 1] = image.data[from + 1] as number;
			onto.data[to + 2] = image.data[from + 2] as number;
			onto.data[to + 3] = 255;
		}
	}
}

/** Fits an image inside a box, keeping its shape, and pastes it centred on a background. */
export function pasteFitted(
	onto: Rgba,
	image: Rgba,
	x: number,
	y: number,
	width: number,
	height: number,
	background: readonly number[] = [24, 24, 24],
): void {
	fillBox(onto, x, y, width, height, background);
	const s = Math.min(width / image.width, height / image.height);
	const w = Math.max(1, Math.round(image.width * s));
	const h = Math.max(1, Math.round(image.height * s));
	paste(
		onto,
		resize(image, w, h),
		x + Math.floor((width - w) / 2),
		y + Math.floor((height - h) / 2),
	);
}

/**
 * A 5 by 7 bitmap font of capitals, digits and the signs a sheet's labels use. Each glyph is seven
 * rows of five cells, read left to right and top to bottom; `#` is ink.
 */
const GLYPHS: Readonly<Record<string, string>> = {
	A: '.###.#...##...#######...##...##...#',
	B: '####.#...##...#####.#...##...#####.',
	C: '.###.#...##....#....#....#...#.###.',
	D: '####.#...##...##...##...##...#####.',
	E: '######....#....####.#....#....#####',
	F: '######....#....####.#....#....#....',
	G: '.###.#...##....#.####...##...#.####',
	H: '#...##...##...#######...##...##...#',
	I: '.###...#....#....#....#....#...###.',
	J: '..###...#....#....#....#.#..#..##..',
	K: '#...##..#.#.#..##...#.#..#..#.#...#',
	L: '#....#....#....#....#....#....#####',
	M: '#...###.###.#.##.#.##...##...##...#',
	N: '#...##...###..##.#.##..###...##...#',
	O: '.###.#...##...##...##...##...#.###.',
	P: '####.#...##...#####.#....#....#....',
	Q: '.###.#...##...##...##.#.##..#..##.#',
	R: '####.#...##...#####.#.#..#..#.#...#',
	S: '.#####....#.....###.....#....#####.',
	T: '#####..#....#....#....#....#....#..',
	U: '#...##...##...##...##...##...#.###.',
	V: '#...##...##...##...##...#.#.#...#..',
	W: '#...##...##...##.#.##.#.##.#.#.#.#.',
	X: '#...##...#.#.#...#...#.#.#...##...#',
	Y: '#...##...#.#.#...#....#....#....#..',
	Z: '#####....#...#...#...#...#....#####',
	'0': '.###.#...##..###.#.###..##...#.###.',
	'1': '..#...##....#....#....#....#...###.',
	'2': '.###.#...#....#...#...#...#...#####',
	'3': '#####...#...#.....#.....##...#.###.',
	'4': '...#...##..#.#.#..#.#####...#....#.',
	'5': '######....####.....#....##...#.###.',
	'6': '..##..#...#....####.#...##...#.###.',
	'7': '#####....#...#...#...#....#....#...',
	'8': '.###.#...##...#.###.#...##...#.###.',
	'9': '.###.#...##...#.####....#...#..##..',
	' ': '...................................',
	'.': '..........................##...##..',
	',': '.....................##....#...#...',
	':': '......##...##........##...##.......',
	';': '......##...##........##....#...#...',
	'-': '...............#####...............',
	'+': '.......#....#..#####..#....#.......',
	'=': '..........#####.....#####..........',
	'/': '.........#...#...#...#...#.........',
	'(': '...#...#...#....#....#.....#.....#.',
	')': '.#.....#.....#....#....#...#...#...',
	'%': '##...##..#...#...#...#...#..##...##',
	'°': '.##..#..#.#..#..##.................',
	_: '..............................#####',
	'<': '...#...#...#...#.....#.....#.....#.',
	'>': '.#.....#.....#.....#...#...#...#...',
	'?': '.###.#...#....#...#...#.........#..',
	'!': '..#....#....#....#....#.........#..',
	"'": '..#....#...#.......................',
	'#': '.#.#..#.#.#####.#.#.#####.#.#..#.#.',
	'*': '.......#..#.#.#.###.#.#.#..#.......',
	'[': '.###..#....#....#....#....#....###.',
	']': '.###....#....#....#....#....#..###.',
	'|': '..#....#....#....#....#....#....#..',
};

/** The width in pixels of a text at a scale, with one cell of space between glyphs. */
export function textWidth(text: string, scale: number): number {
	return text.length * 6 * scale;
}

/** Draws a line of text with its top left corner at (x, y). Lower case draws as capitals. */
export function drawText(
	image: Rgba,
	text: string,
	x: number,
	y: number,
	scale: number,
	colour: readonly number[],
): void {
	let left = x;
	for (const char of text.toUpperCase()) {
		const glyph = GLYPHS[char] ?? GLYPHS['?'] ?? '';
		for (let cell = 0; cell < 35; cell++)
			if (glyph[cell] === '#')
				fillBox(
					image,
					left + (cell % 5) * scale,
					y + Math.floor(cell / 5) * scale,
					scale,
					scale,
					colour,
				);
		left += 6 * scale;
	}
}
