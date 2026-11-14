// Reports what the browser and device can do, as the engine reads it at startup, without starting
// the engine, and the faults of the browser's image buffers, which the engine's textures need. It
// works even where the engine cannot start.
import { probeCapabilities } from '@null3d/engine/internal';
import { imageBufferFaults } from './lib/image-buffers';
import { run } from './lib/result';

run('capabilities', async () => ({
	report: { ...(await probeCapabilities()), imageBufferFaults: await imageBufferFaults() },
}));
