// The one-pixel lines' scene (bench/scenes/lines.ts), which the parity test also draws with
// three.js's Line, LineSegments and LineLoop with a LineBasicMaterial, and a dashed line with a
// LineDashedMaterial.
import { defineSketch } from '@null3d/engine';
import { BASIC_LINES } from '../../../bench/scenes/lines';
import { drawLineScene } from '../lib/line-scene';

export default defineSketch(async (context) => {
	await drawLineScene(context, BASIC_LINES);
});
