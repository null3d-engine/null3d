// The render worker for a page that draws with WebGL2. Its file holds the WebGL2 renderers and none
// of WebGPU's.

import * as webgl2 from '../render/webgl2-renderer';
import { drawWith } from './render-worker';

drawWith(webgl2);
