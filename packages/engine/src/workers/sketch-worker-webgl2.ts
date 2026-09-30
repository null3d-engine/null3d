// The sketch worker in low-latency mode on WebGL2, where it also draws. It loads the WebGL2
// renderers with the frame loops as one file, while the core and the sketch start.

import { drawWith } from './sketch-worker';

drawWith(() => import('../render/webgl2-renderer'));
