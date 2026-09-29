// A sketch whose setup passes the scene API a color that it cannot read. The engine error that the
// call throws ends the setup, so the engine's start fails with it.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene }) => {
	scene.setBackground('blue-ish');
	return {};
});
