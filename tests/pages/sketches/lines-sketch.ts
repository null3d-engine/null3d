// The wide lines' scene (bench/scenes/lines.ts), which the parity test also draws with three.js's
// Line2 and LineSegments2: widths in pixels and in world units, round joins, colors at each point,
// dashes, a loop and a blended line, over a floor and in front of a wall.
import { defineSketch } from '@null3d/engine';
import { WIDE_LINES } from '../../../bench/scenes/lines';
import { drawLineScene } from '../lib/line-scene';

export default defineSketch(async (context) => {
	await drawLineScene(context, WIDE_LINES);
});
