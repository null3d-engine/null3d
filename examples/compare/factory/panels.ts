// The status screens under the hall's spot lights, drawn into a texture from code. Each screen
// shows a parts count as a seven-segment pair, bars for the cell's load, a row of cell lamps and a
// warning strip, behind the red, green and blue stripes of an LCD panel, with a few dead cells.
// Both engines upload these texels, so the two halves draw the same screens.
import { hash01, type TextureData } from '../../lib/compare-scene';

/** A screen's texels on each side. */
export const PANEL_TEXELS = 256;

/** The two screens' colors: a cool status display and a warm one. */
const TINTS: readonly (readonly [number, number, number])[] = [
	[0.35, 0.85, 1],
	[1, 0.7, 0.28],
];

/** The segments of each digit, as the bits of a seven-segment display. */
const DIGITS = [
	0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111,
	0b1101111,
] as const;

export function panelTexture(variant: number): TextureData {
	const size = PANEL_TEXELS;
	const data = new Uint8Array(size * size * 4);
	const [tr, tg, tb] = TINTS[variant % TINTS.length] as readonly [number, number, number];
	const seed = 31 + variant * 17;
	// The design counts rows from its top. A box's front face reads v = 0 along its bottom edge, and
	// both engines keep row 0 of a data texture at v = 0, so the rows flip as they are written.
	const put = (x: number, y: number, r: number, g: number, b: number, a = 1) => {
		if (x < 0 || y < 0 || x >= size || y >= size) return;
		const at = ((size - 1 - y) * size + x) * 4;
		data[at] = Math.round(Math.min(Math.max(r, 0), 1) * 255);
		data[at + 1] = Math.round(Math.min(Math.max(g, 0), 1) * 255);
		data[at + 2] = Math.round(Math.min(Math.max(b, 0), 1) * 255);
		data[at + 3] = Math.round(Math.min(Math.max(a, 0), 1) * 255);
	};
	const fill = (x0: number, y0: number, x1: number, y1: number, level: number) => {
		for (let y = y0; y < y1; y++)
			for (let x = x0; x < x1; x++) put(x, y, tr * level, tg * level, tb * level);
	};
	// The screen's dark face with a faint glow toward its middle.
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const edge = Math.min(x, y, size - 1 - x, size - 1 - y) / size;
			const glow = 0.02 + 0.05 * Math.min(edge * 8, 1);
			put(x, y, 0.01 + tr * glow, 0.015 + tg * glow, 0.02 + tb * glow);
		}
	// The header: a bar across the top with three short title marks.
	fill(10, 10, size - 10, 30, 0.12);
	fill(16, 16, 56, 24, 0.7);
	fill(62, 16, 92, 24, 0.4);
	// A seven-segment pair: the screen's parts count, 0 to 99, from the seed.
	const count = Math.floor(hash01(seed, 1, 2) * 100);
	const digit = (d: number, x0: number, y0: number) => {
		const bits = DIGITS[d] as number;
		const w = 22;
		const h = 46;
		const t = 6;
		const bar = (x: number, y: number, bw: number, bh: number) => fill(x, y, x + bw, y + bh, 0.95);
		if (bits & 0b0000001) bar(x0 + t, y0, w - 2 * t, t);
		if (bits & 0b0000010) bar(x0 + w - t, y0 + t, t, h / 2 - t);
		if (bits & 0b0000100) bar(x0 + w - t, y0 + h / 2 + t, t, h / 2 - t);
		if (bits & 0b0001000) bar(x0 + t, y0 + h - t, w - 2 * t, t);
		if (bits & 0b0010000) bar(x0, y0 + h / 2 + t, t, h / 2 - t);
		if (bits & 0b0100000) bar(x0, y0 + t, t, h / 2 - t);
		if (bits & 0b1000000) bar(x0 + t, y0 + h / 2 - t / 2, w - 2 * t, t);
	};
	digit(Math.floor(count / 10), 24, 44);
	digit(count % 10, 60, 44);
	// Three load bars, each longer than the one above it.
	const bars = [0.35, 0.62, 0.86];
	for (let k = 0; k < bars.length; k++) {
		const y = 110 + k * 26;
		fill(20, y, size - 20, y + 14, 0.07);
		fill(20, y, 20 + (size - 40) * (bars[k] as number), y + 14, 0.55);
	}
	// The cell lamps: a grid of small squares, most lit.
	for (let row = 0; row < 4; row++)
		for (let col = 0; col < 12; col++) {
			const lit = hash01(seed + 5, col, row) > 0.3 ? 0.8 : 0.06;
			const x = 22 + col * 18;
			const y = 194 + row * 12;
			fill(x, y, x + 10, y + 6, lit);
		}
	// The warning strip: diagonal stripes along the bottom.
	for (let y = 236; y < 250; y++)
		for (let x = 12; x < size - 12; x++) if ((x + y) % 20 < 10) put(x, y, 0.95, 0.42, 0.1);
	// Scan lines, the panel's RGB stripes and a few dead cells.
	for (let y = 0; y < size; y++) {
		const line = y % 3 === 0 ? 0.82 : 1;
		for (let x = 0; x < size; x++) {
			const at = (y * size + x) * 4;
			const stripe = x % 3;
			const red = (data[at] as number) * line * (stripe === 0 ? 1.12 : 0.9);
			const green = (data[at + 1] as number) * line * (stripe === 1 ? 1.12 : 0.9);
			const blue = (data[at + 2] as number) * line * (stripe === 2 ? 1.12 : 0.9);
			data[at] = Math.min(255, red);
			data[at + 1] = Math.min(255, green);
			data[at + 2] = Math.min(255, blue);
		}
	}
	for (let k = 0; k < 24; k++) {
		const x = Math.floor(hash01(seed + 9, k, 1) * (size - 3));
		const y = Math.floor(hash01(seed + 9, k, 2) * (size - 3));
		for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) put(x + dx, y + dy, 0, 0, 0);
	}
	return { size, data, colorSpace: 'srgb' };
}
