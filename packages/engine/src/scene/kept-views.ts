// For unit tests: the typed arrays that an object of the scene API still keeps of one buffer of the
// engine memory, in its own fields and one level down, such as a batch's object of row arrays. A
// view that outlives a growth of the shared memory keeps the old buffer alive (hard rule 20).

/** The views that `holder` keeps of `buffer`, in its own fields and the fields of their objects. */
export function keptViews(holder: object, buffer: ArrayBufferLike): ArrayBufferView[] {
	const kept: ArrayBufferView[] = [];
	const look = (value: unknown) => {
		if (ArrayBuffer.isView(value) && value.buffer === buffer) kept.push(value);
	};
	for (const value of Object.values(holder)) {
		look(value);
		if (value && typeof value === 'object' && !ArrayBuffer.isView(value))
			for (const inner of Object.values(value)) look(inner);
	}
	return kept;
}
