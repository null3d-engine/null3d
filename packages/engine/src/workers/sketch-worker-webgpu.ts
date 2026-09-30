// The sketch worker in low-latency mode on WebGPU, where it also draws. It loads the WebGPU
// renderers with the frame loops as one file, while the core and the sketch start.

import { drawWith } from './sketch-worker';

drawWith(() => import('../render/webgpu-renderer'));
