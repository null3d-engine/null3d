// One oak crown at three distances from one camera, drawn with the atlases' leaf material: the
// near tree shows the leaf cards at full detail, and the two further ones show the levels that the
// atlas paints for their size. A crown keeps the share of the picture that it covers, so the far
// trees stay as dense as the near one.
import { defineSketch } from '@null3d/engine';
import { addCrownRow } from '../lib/crown-row';

export default defineSketch((ctx) => {
	addCrownRow(ctx, true);
	return {};
});
