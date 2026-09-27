// Types for the parts of the gifenc package that the README animation uses; the package ships none.
declare module 'gifenc' {
	/** A palette of up to 256 colors, each as red, green and blue from 0 to 255. */
	export type Palette = number[][];

	/** A palette for the pixels of an RGBA image. */
	export function quantize(rgba: Uint8Array, maxColors: number): Palette;

	/** The palette index of each pixel of an RGBA image. */
	export function applyPalette(rgba: Uint8Array, palette: Palette): Uint8Array;

	export interface GifStream {
		/** Adds a frame. The first frame needs a palette, which later frames use when they give none. */
		writeFrame(
			index: Uint8Array,
			width: number,
			height: number,
			options?: { palette?: Palette; delay?: number; repeat?: number },
		): void;
		/** Ends the stream. */
		finish(): void;
		/** The encoded file. */
		bytes(): Uint8Array;
	}

	export function GIFEncoder(): GifStream;
}
