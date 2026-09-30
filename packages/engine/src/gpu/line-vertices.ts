// The vertex layout of the debug lines: a position relative to the camera, three 32-bit floats,
// then an sRGB color, four bytes that the vertex fetch reads as values from 0 to 1. The WebGPU
// backend gives it to the pipeline as is, and the WebGL2 backend makes a vertex array from it.

import { SIZE_LINE_VERTEX_BYTES } from '../generated/gpu';

/** Where the color sits in a vertex: after the position's three floats. */
const COLOR_OFFSET = 12;

export const LINE_VERTICES: GPUVertexBufferLayout = {
	arrayStride: SIZE_LINE_VERTEX_BYTES,
	stepMode: 'vertex',
	attributes: [
		{ shaderLocation: 0, offset: 0, format: 'float32x3' },
		{ shaderLocation: 1, offset: COLOR_OFFSET, format: 'unorm8x4' },
	],
};
