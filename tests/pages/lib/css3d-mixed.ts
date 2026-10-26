// The scene of three.js's CSS3D mixed example (examples/css3d_mixed.html, r186): a wireframe room,
// a blue frame drawn by WebGL, and an embedded web page that CSS3D turns with the scene. The
// example loads a second three.js example into its iframe; this port embeds a page made in code, so
// a held picture needs no network and repeats. The example draws the edges of a segmented box,
// and EdgesGeometry drops the edges between flat faces, so the example shows the same twelve outer
// edges that the port draws. An invisible plane at the page's plane writes depth alone, as the
// example's no-blend plane does, so the room's edges and the frame's back faces stay behind it.
import type { Vec3 } from '@null3d/engine';

/** The example's camera: its lens and place. */
export const CAMERA = { fov: 50, near: 1, far: 10_000, position: [-1000, 500, 1500] as Vec3 };

/** The room's size: the example's 4000 by 2000 by 4000 box. */
export const ROOM: Vec3 = [4000, 2000, 4000];

/** The frame's opening, its border's thickness and the depth that the border reaches. */
export const FRAME = { width: 1024, height: 768, thickness: 50 };

/** The example's hemisphere light, whose direction is its position. */
export const LIGHT_POSITION: Vec3 = [-25, 100, 50];

/** The direction of the example's hemisphere light, in unit length. */
export const LIGHT_DIRECTION: Vec3 = ((): Vec3 => {
	const [x, y, z] = LIGHT_POSITION;
	const length = Math.hypot(x, y, z);
	return [x / length, y / length, z / length];
})();

/** The frame's bars: their centre, size and depth, centred on the opening's plane. */
export const BARS: readonly { position: Vec3; scale: Vec3 }[] = [
	{
		position: [0, FRAME.height / 2 + FRAME.thickness / 2, -FRAME.thickness / 2],
		scale: [FRAME.width + FRAME.thickness * 2, FRAME.thickness, FRAME.thickness],
	},
	{
		position: [0, -(FRAME.height / 2 + FRAME.thickness / 2), -FRAME.thickness / 2],
		scale: [FRAME.width + FRAME.thickness * 2, FRAME.thickness, FRAME.thickness],
	},
	{
		position: [-(FRAME.width / 2 + FRAME.thickness / 2), 0, -FRAME.thickness / 2],
		scale: [FRAME.thickness, FRAME.height, FRAME.thickness],
	},
	{
		position: [FRAME.width / 2 + FRAME.thickness / 2, 0, -FRAME.thickness / 2],
		scale: [FRAME.thickness, FRAME.height, FRAME.thickness],
	},
];

/** The page that the iframe shows, as markup: a title card made in code. A page sets it as the
 * iframe's `srcdoc`, so the frame keeps the page's origin and its isolation headers. */
export function embeddedPage(): string {
	const html = [
		'<!doctype html><html><head><meta charset="utf-8"><style>',
		'html,body{height:100%}',
		'body{margin:0;display:grid;place-items:center;',
		'background:linear-gradient(135deg,#0b1e3a 0%,#2d5f8a 55%,#7fc4e8 100%);',
		'color:#fff;font-family:Helvetica,Arial,sans-serif;text-align:center}',
		'h1{margin:0;font-size:64px;letter-spacing:6px}',
		'p{margin:16px 0 0;font-size:22px;color:#cfe6f5}',
		'</style></head><body><div><h1>EMBEDDED</h1><p>a page that CSS turns with the scene</p></div>',
		'</body></html>',
	].join('');
	return html;
}

/** The element of the embedded page: the example's iframe, sized to the frame's opening. */
export function embeddedElement(): HTMLIFrameElement {
	const element = document.createElement('iframe');
	element.style.width = `${FRAME.width + 4}px`;
	element.style.height = `${FRAME.height}px`;
	element.style.border = '0';
	element.style.backfaceVisibility = 'hidden';
	// CSS3DRenderer gives its elements the pointer; the engine leaves that to the page.
	element.style.pointerEvents = 'auto';
	element.addEventListener('load', () => {
		element.dataset.loaded = '1';
	});
	element.srcdoc = embeddedPage();
	return element;
}

/** The room's twelve edges as pairs of points, which a line batch draws. */
export function roomEdges(): number[] {
	const [width, height, depth] = ROOM;
	const x = width / 2;
	const y = height / 2;
	const z = depth / 2;
	const points: number[] = [];
	const corner = (sx: number, sy: number, sz: number) => [sx * x, sy * y, sz * z];
	// Four edges along x, four along y, and four along z.
	for (const sy of [-1, 1])
		for (const sz of [-1, 1]) {
			points.push(...corner(-1, sy, sz), ...corner(1, sy, sz));
			points.push(...corner(sy, -1, sz), ...corner(sy, 1, sz));
			points.push(...corner(sy, sz, -1), ...corner(sy, sz, 1));
		}
	return points;
}
