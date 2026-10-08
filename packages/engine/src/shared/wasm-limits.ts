// Reads the limits of the memory that a WebAssembly module imports from the module's first bytes.
// It needs no browser API, so the build tools use it too.

/** The limits of the memory that a module imports. */
export interface MemoryLimits {
	/** Initial size in 64 KiB pages. */
	initial: number;
	/** Declared maximum in 64 KiB pages, or null when the module declares none. */
	maximum: number | null;
	shared: boolean;
}

/** Reads an unsigned LEB128 number at `offset`: the value and the offset after it, or null past the end. */
function readLeb(bytes: Uint8Array, offset: number): [number, number] | null {
	let value = 0;
	let shift = 0;
	for (let at = offset; at < bytes.length; at++) {
		const byte = bytes[at] as number;
		value += (byte & 0x7f) * 2 ** shift;
		if ((byte & 0x80) === 0) return [value, at + 1];
		shift += 7;
	}
	return null;
}

/** The section that lists a module's imports. Only custom sections and the type section come before it. */
const IMPORT_SECTION = 2;

/**
 * The limits of the memory that a module imports, from the start of its bytes: null when it
 * imports no memory, and undefined when the bytes end before the import section does.
 */
export function memoryImportLimits(bytes: Uint8Array): MemoryLimits | null | undefined {
	let at = 8;
	while (at < bytes.length) {
		const id = bytes[at] as number;
		const header = readLeb(bytes, at + 1);
		if (!header) return undefined;
		const [size, start] = header;
		if (id > IMPORT_SECTION) return null;
		if (start + size > bytes.length) return undefined;
		if (id === IMPORT_SECTION) return importedMemory(bytes.subarray(start, start + size));
		at = start + size;
	}
	return undefined;
}

/** The limits of the memory in an import section's content, or null when it imports none. */
function importedMemory(section: Uint8Array): MemoryLimits | null {
	const leb = (offset: number) => readLeb(section, offset) ?? [0, section.length];
	let [count, cursor] = leb(0);
	for (; count > 0 && cursor < section.length; count--) {
		for (let name = 0; name < 2; name++) {
			const [length, afterLength] = leb(cursor);
			cursor = afterLength + length;
		}
		const kind = section[cursor++];
		if (kind === 0) {
			cursor = leb(cursor)[1];
		} else if (kind === 1) {
			cursor++;
			const flags = section[cursor++] ?? 0;
			cursor = leb(cursor)[1];
			if (flags & 1) cursor = leb(cursor)[1];
		} else if (kind === 2) {
			const flags = section[cursor++] ?? 0;
			const [initial, afterInitial] = leb(cursor);
			const maximum = flags & 1 ? leb(afterInitial)[0] : null;
			return { initial, maximum, shared: (flags & 2) !== 0 };
		} else if (kind === 3) {
			cursor += 2;
		} else {
			cursor++;
			cursor = leb(cursor)[1];
		}
	}
	return null;
}
