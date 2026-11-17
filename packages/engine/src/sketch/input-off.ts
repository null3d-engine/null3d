// The notes of a development build when a sketch relies on input that the page does not write. A
// page that starts the engine with `input: false` writes no input, so a sketch that reads
// `ctx.input`, gives an object a pointer event handler or uses @null3d/controls hears nothing, and
// nothing else says why. The sketch's thread then says so in the console, once for each kind, and
// names the option. Every call into this module sits behind DEV, so a production build leaves it out.

/** The kinds of reliance on input that a note names. */
export type InputOffKind = 'read' | 'events' | 'controls';

/** Each kind's note. */
export const INPUT_OFF_NOTES: Readonly<Record<InputOffKind, string>> = {
	read: 'null3D: ctx.input was read, but the page started the engine with input: false. So every key and button stays up, and the pointer stays still. Read the input from the code that records it, or start the engine without input: false.',
	events:
		'null3D: an object got a pointer event handler, but the page started the engine with input: false. So no object gets a pointer event. Hit-test the pointer in the code that records the input, or start the engine without input: false.',
	controls:
		'null3D: the sketch uses @null3d/controls, but the page started the engine with input: false. So the controls hear no input and never move the camera. Move the camera from the state that the page sends, or start the engine without input: false.',
};

/** Says each kind's note once. */
export class InputOffNotes {
	private readonly said = new Set<InputOffKind>();

	constructor(private readonly say: (note: string) => void = console.warn) {}

	/** Says the note of `kind`, unless it was said before. */
	note(kind: InputOffKind): void {
		if (this.said.has(kind)) return;
		this.said.add(kind);
		this.say(INPUT_OFF_NOTES[kind]);
	}
}

/** Makes `context.input` a getter that keeps its value and says the read's note at the first read. */
export function noteInputReads(context: { input: unknown }, notes: InputOffNotes): void {
	const { input } = context;
	Object.defineProperty(context, 'input', {
		configurable: true,
		enumerable: true,
		get() {
			notes.note('read');
			return input;
		},
	});
}
