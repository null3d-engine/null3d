// Reports what the browser and device can do, as the engine reads it at startup, without starting
// the engine. It works even where the engine cannot start.
import { probeCapabilities } from '@null3d/engine/internal';
import { run } from './lib/result';

run('capabilities', async () => ({ report: await probeCapabilities() }));
