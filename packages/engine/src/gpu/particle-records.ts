// The vertex layout of a particle system's records, one record per instance: the birth place and
// birth time as four 32-bit floats, the start velocity as three, then the lifetime and the seed
// packed in one 32-bit word, which the shader reads as an integer. The WebGPU backend gives it to
// the pipeline as is, and the WebGL2 backend makes a vertex array from it, with a divisor for each
// attribute of the instance's step.

import { PARTICLE_RECORD_BYTES } from '../generated/core';

export const PARTICLE_RECORDS: GPUVertexBufferLayout = {
	arrayStride: PARTICLE_RECORD_BYTES,
	stepMode: 'instance',
	attributes: [
		{ shaderLocation: 0, offset: 0, format: 'float32x4' },
		{ shaderLocation: 1, offset: 16, format: 'float32x3' },
		{ shaderLocation: 2, offset: 28, format: 'uint32' },
	],
};
