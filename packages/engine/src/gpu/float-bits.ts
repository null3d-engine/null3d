// Draw lists keep float operands as their 32-bit patterns. Most commands read them through the
// float view of the list, but pipeline creation also runs where only the word view is at hand.

const word = new Uint32Array(1);
const float = new Float32Array(word.buffer);

/** The 32-bit float whose bit pattern is `bits`. */
export function floatOfBits(bits: number): number {
	word[0] = bits;
	return float[0] as number;
}
