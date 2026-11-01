// Three leaf cards that face the camera at three distances, from the leaf atlas that the GPU paints
// at first use: the near card shows the atlas at full size, and the far ones the levels that its
// pixels ask for.
import { defineSketch } from '@null3d/engine';
import { addLeafCardRow } from '../lib/leaf-card-row';

export default defineSketch((ctx) => {
	addLeafCardRow(ctx);
	return {};
});
