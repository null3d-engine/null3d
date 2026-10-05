// The readers of color grading table files, which `assets.loadLut` imports the first time, so a
// page without tables never downloads them. Each reads a file's text in one pass over its
// characters, with no string per number, and writes the table's texels as linear 8-bit color, red
// fastest, then green, then blue, as a 3D texture holds them.
//
// - `.cube` (Adobe's and DaVinci Resolve's form): `LUT_3D_SIZE`, an optional `TITLE`, the domain
//   from `DOMAIN_MIN` and `DOMAIN_MAX` or from Resolve's `LUT_3D_INPUT_RANGE`, then one line of
//   three numbers per texel, red fastest. three.js's `LUTCubeLoader` reads the same form.
// - `.3dl` (Autodesk's form): an optional line of the input grid, such as `0 64 128 ... 1023`, then
//   one line of three whole numbers per texel, blue fastest. The output's bit depth comes from a
//   Lustre `Mesh` line, or else from the largest value. three.js's `LUT3dlLoader` reads the same
//   form, but refuses a grid whose steps differ by one from rounding, as many files' do.

/** The fewest and the most texels along each side of a table. */
export const MIN_LUT_SIZE = 2;
export const MAX_LUT_SIZE = 256;

/**
 * The smallest span of a domain along an axis: the smallest normal 32-bit float. The core places
 * colors in the domain in 32-bit floats, and divides by the span.
 */
const MIN_DOMAIN_SPAN = 2 ** -126;

/** A table as a file gives it. */
export interface LutTable {
	/** Texels along each side. */
	size: number;
	/** The title that a `.cube` file names. */
	title: string | undefined;
	/** The colors that the first and the last texel along each axis stand for, red first. */
	domainMin: [number, number, number];
	domainMax: [number, number, number];
	/** Four bytes per texel, red fastest, then green, then blue. */
	texels: Uint8Array;
}

const SPACE = 32;
const HASH = 35;
const PLUS = 43;
const MINUS = 45;
const DOT = 46;
const ZERO = 48;
const NINE = 57;
const LOWER_E = 101;
const UPPER_E = 69;

/** True for a character that starts a number. */
function startsNumber(code: number): boolean {
	return (code >= ZERO && code <= NINE) || code === MINUS || code === PLUS || code === DOT;
}

/**
 * Reads lines of three numbers and keyword lines. Numbers parse in place: `next` reads the next
 * number of the current line and leaves `at` past it.
 */
class Scanner {
	/** The current line, from `start` to `end`, with its spaces trimmed. */
	start = 0;
	end = 0;
	/** The place of the next number in the line. */
	at = 0;
	/** The line's number, counting from 1, for errors. */
	line = 0;
	private nextLine = 0;

	constructor(private readonly text: string) {}

	/** Moves to the next line that holds anything but spaces and a comment. False at the end. */
	advance(): boolean {
		const { text } = this;
		while (this.nextLine < text.length) {
			let end = text.indexOf('\n', this.nextLine);
			if (end < 0) end = text.length;
			let start = this.nextLine;
			this.nextLine = end + 1;
			this.line++;
			while (start < end && text.charCodeAt(start) <= SPACE) start++;
			while (end > start && text.charCodeAt(end - 1) <= SPACE) end--;
			if (start === end || text.charCodeAt(start) === HASH) continue;
			this.start = start;
			this.end = end;
			this.at = start;
			return true;
		}
		return false;
	}

	/** True when the line starts with a number. */
	numeric(): boolean {
		return startsNumber(this.text.charCodeAt(this.start));
	}

	/** The line as text. */
	lineText(): string {
		return this.text.slice(this.start, this.end);
	}

	/** The next number of the line, or NaN when the line has no more numbers or holds another word. */
	next(): number {
		const { text, end } = this;
		let i = this.at;
		while (i < end && text.charCodeAt(i) <= SPACE) i++;
		if (i >= end) {
			this.at = i;
			return Number.NaN;
		}
		let sign = 1;
		let code = text.charCodeAt(i);
		if (code === MINUS || code === PLUS) {
			if (code === MINUS) sign = -1;
			i++;
		}
		let mantissa = 0;
		let digits = 0;
		let scale = 0;
		for (let digit = this.digit(i); digit >= 0; digit = this.digit(i)) {
			mantissa = mantissa * 10 + digit;
			digits++;
			i++;
		}
		if (i < end && text.charCodeAt(i) === DOT) {
			i++;
			for (let digit = this.digit(i); digit >= 0; digit = this.digit(i)) {
				mantissa = mantissa * 10 + digit;
				digits++;
				scale--;
				i++;
			}
		}
		if (digits === 0) {
			this.at = end;
			return Number.NaN;
		}
		code = i < end ? text.charCodeAt(i) : 0;
		if (code === LOWER_E || code === UPPER_E) {
			i++;
			let exponentSign = 1;
			code = text.charCodeAt(i);
			if (code === MINUS || code === PLUS) {
				if (code === MINUS) exponentSign = -1;
				i++;
			}
			let exponent = 0;
			let exponentDigits = 0;
			for (let digit = this.digit(i); digit >= 0; digit = this.digit(i)) {
				exponent = exponent * 10 + digit;
				exponentDigits++;
				i++;
			}
			if (exponentDigits === 0) {
				this.at = end;
				return Number.NaN;
			}
			scale += exponentSign * exponent;
		}
		if (i < end && text.charCodeAt(i) > SPACE) {
			this.at = end;
			return Number.NaN;
		}
		this.at = i;
		return sign * (scale < 0 ? mantissa / 10 ** -scale : mantissa * 10 ** scale);
	}

	/** The value of the digit at `i` in the line, or -1 for another character or the line's end. */
	private digit(i: number): number {
		const code = i < this.end ? this.text.charCodeAt(i) : -1;
		return code >= ZERO && code <= NINE ? code - ZERO : -1;
	}

	/** True when the line holds nothing past the numbers read so far. */
	done(): boolean {
		const { text, end } = this;
		let i = this.at;
		while (i < end && text.charCodeAt(i) <= SPACE) i++;
		return i >= end;
	}
}

/** A failure to read a table, with the line where it happened when there is one. */
export class LutFileError extends Error {}

function fail(reason: string, line?: number): never {
	throw new LutFileError(line === undefined ? reason : `line ${line}: ${reason}`);
}

/** Checks a table's size, from its keyword or its grid. */
function checkSize(size: number, line?: number): void {
	if (!(Number.isInteger(size) && size >= MIN_LUT_SIZE && size <= MAX_LUT_SIZE))
		fail(
			`a table of ${size} texels a side; the engine reads ${MIN_LUT_SIZE} to ${MAX_LUT_SIZE}`,
			line,
		);
}

/** An 8-bit value of a color from 0 to 1, rounded, and clamped to that range. */
function byte(value: number): number {
	return Math.round(Math.min(Math.max(value, 0), 1) * 255);
}

/**
 * Reads a `.cube` or a `.3dl` file's text. A file that names `LUT_3D_SIZE` or `LUT_1D_SIZE` is a
 * `.cube` file, and any other is read as a `.3dl` file. Throws a `LutFileError` that says what in
 * the file the engine cannot read.
 */
export function parseLut(text: string): LutTable {
	return /^\s*LUT_[13]D_SIZE\b/m.test(text) ? parseCube(text) : parse3dl(text);
}

/** The words of a keyword line: its keyword, then the rest. */
function words(line: string): string[] {
	return line.split(/\s+/);
}

/** Reads a `.cube` file's text. */
export function parseCube(text: string): LutTable {
	const scan = new Scanner(text);
	let size = 0;
	let title: string | undefined;
	const domainMin: [number, number, number] = [0, 0, 0];
	const domainMax: [number, number, number] = [1, 1, 1];
	let texels: Uint8Array | undefined;
	let count = 0;
	while (scan.advance()) {
		if (scan.numeric()) {
			if (!texels) fail('a texel before LUT_3D_SIZE', scan.line);
			if (count === size ** 3) fail(`more than ${size ** 3} texels`, scan.line);
			const at = count * 4;
			for (let channel = 0; channel < 3; channel++) {
				const value = scan.next();
				if (Number.isNaN(value)) fail('a texel that is not three numbers', scan.line);
				texels[at + channel] = byte(value);
			}
			if (!scan.done()) fail('a texel that is not three numbers', scan.line);
			texels[at + 3] = 255;
			count++;
			continue;
		}
		const line = scan.lineText();
		const [keyword = '', ...rest] = words(line);
		const numbers = (expected: number): number[] => {
			const values = rest.map(Number);
			if (
				values.length !== expected ||
				values.some((value) => !Number.isFinite(Math.fround(value)))
			)
				fail(`${keyword} without ${expected} numbers`, scan.line);
			return values;
		};
		switch (keyword) {
			case 'TITLE': {
				const quoted = /"([^"]*)"/.exec(line);
				title = quoted ? quoted[1] : rest.join(' ');
				break;
			}
			case 'LUT_3D_SIZE': {
				if (texels) fail('a second LUT_3D_SIZE', scan.line);
				[size] = numbers(1) as [number];
				checkSize(size, scan.line);
				texels = new Uint8Array(size ** 3 * 4);
				break;
			}
			case 'LUT_1D_SIZE':
				fail('a 1D table, which the engine does not read: export the grade as a 3D table');
				break;
			case 'DOMAIN_MIN':
				domainMin.splice(0, 3, ...numbers(3));
				break;
			case 'DOMAIN_MAX':
				domainMax.splice(0, 3, ...numbers(3));
				break;
			case 'LUT_3D_INPUT_RANGE': {
				const [low, high] = numbers(2) as [number, number];
				domainMin.fill(low);
				domainMax.fill(high);
				break;
			}
			default:
				// Other keywords, such as Resolve's LUT_IN_VIDEO_RANGE, change nothing that the
				// table's texels hold.
				break;
		}
	}
	if (!texels) fail('no LUT_3D_SIZE');
	if (count !== size ** 3) fail(`${count} texels where a table of ${size} a side has ${size ** 3}`);
	for (let axis = 0; axis < 3; axis++) {
		const span = Math.fround(
			Math.fround(domainMax[axis] as number) - Math.fround(domainMin[axis] as number),
		);
		if (!(span >= MIN_DOMAIN_SPAN))
			fail('a domain whose maximum is not above its minimum by a span that 32-bit floats hold');
		if (!Number.isFinite(span)) fail('a domain wider than 32-bit floats hold');
	}
	return { size, title, domainMin, domainMax, texels };
}

/** The bits that hold whole numbers up to `value`. */
function bitsFor(value: number): number {
	return Math.ceil(Math.log2(value + 1));
}

/** The most numbers that a `.3dl` file holds: three per texel of the largest table, and its grid. */
const MAX_3DL_VALUES = 3 * MAX_LUT_SIZE ** 3 + MAX_LUT_SIZE;

/**
 * Reads a `.3dl` file's text. It stops with an error once the file holds more than `most`
 * numbers, before it keeps them all.
 */
export function parse3dl(text: string, most = MAX_3DL_VALUES): LutTable {
	const scan = new Scanner(text);
	let outputBits = 0;
	const values: number[] = [];
	/** The numbers on the first line of numbers, which may be the input grid. */
	let firstLine = 0;
	while (scan.advance()) {
		const first = values.length;
		let value = scan.numeric() ? scan.next() : Number.NaN;
		while (!Number.isNaN(value)) {
			if (!(Number.isInteger(value) && value >= 0 && value <= 0xffff))
				fail(`${value}, which is not a whole number from 0 to 65535`, scan.line);
			// The largest table and its input grid: the reader stops before it keeps more.
			if (values.length >= most)
				fail(`more numbers than a table of ${MAX_LUT_SIZE} a side holds`, scan.line);
			values.push(value);
			value = scan.next();
		}
		const read = values.length - first;
		if (read === 0) {
			// A word, such as 3DMESH. Lustre's `Mesh <input bits> <output bits>` line names the
			// output's depth.
			const [keyword, , output] = words(scan.lineText());
			if (keyword === 'Mesh' && output !== undefined) outputBits = Number(output);
			continue;
		}
		if (!scan.done()) fail('a line that holds more than whole numbers', scan.line);
		if (first === 0) firstLine = read;
		else if (read !== 3) fail('a texel that is not three whole numbers', scan.line);
	}
	if (firstLine !== 3 && firstLine < MIN_LUT_SIZE) fail('a texel that is not three whole numbers');
	// The first line is the input grid when it does not hold three numbers, or when it holds three
	// that rise from 0 before 27 texels, as a grid of 3 points does.
	const rising = values[0] === 0 && (values[1] as number) < (values[2] as number);
	const isGrid = firstLine !== 3 || (rising && values.length === 3 + 27 * 3);
	const grid = isGrid ? values.splice(0, firstLine) : undefined;
	const count = values.length / 3;
	const size = grid ? grid.length : Math.round(Math.cbrt(count));
	checkSize(size);
	if (count !== size ** 3) fail(`${count} texels where a table of ${size} a side has ${size ** 3}`);
	if (grid) {
		// The grid's points are even steps of the input's range, each rounded to a whole number.
		const last = grid[size - 1] as number;
		for (let k = 0; k < size; k++)
			if (Math.abs((grid[k] as number) - (k * last) / (size - 1)) > 1)
				fail('an input grid whose points are not evenly spaced');
	}
	let largest = 0;
	for (const value of values) if (value > largest) largest = value;
	const bits = outputBits > 0 ? outputBits : Math.max(bitsFor(largest), bitsFor(grid?.at(-1) ?? 0));
	const top = 2 ** bits - 1;
	const texels = new Uint8Array(count * 4);
	const sizeSquared = size * size;
	for (let k = 0; k < count; k++) {
		// Blue grows fastest in the file, red fastest in the texture.
		const r = Math.floor(k / sizeSquared);
		const g = Math.floor(k / size) % size;
		const b = k % size;
		const at = ((b * size + g) * size + r) * 4;
		for (let channel = 0; channel < 3; channel++)
			texels[at + channel] = byte((values[3 * k + channel] as number) / top);
		texels[at + 3] = 255;
	}
	return { size, title: undefined, domainMin: [0, 0, 0], domainMax: [1, 1, 1], texels };
}
