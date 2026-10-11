// Night town, the three.js half, as it runs in its worker with an OffscreenCanvas. The scene's
// build (three-build.ts) does the work, and the shared worker (examples/lib/three-worker.ts) draws
// the sky, the fog and the post effects around it.
import { runThreeWorker } from '../../lib/three-worker';
import { buildNightTown } from './three-build';

runThreeWorker(buildNightTown);
