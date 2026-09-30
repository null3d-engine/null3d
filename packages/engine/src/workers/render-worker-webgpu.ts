// The render worker for a page that draws with WebGPU, core or in compatibility mode. Its file holds
// the WebGPU renderers and none of WebGL2's.

import * as webgpu from '../render/webgpu-renderer';
import { drawWith } from './render-worker';

drawWith(webgpu);
