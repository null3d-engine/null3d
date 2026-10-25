// The scene of three.js's CSS3D youtube example (examples/css3d_youtube.html, r186): four embedded
// pages in a ring, each turned to face out of it, so the camera at one corner sees all four at an
// angle. The example embeds YouTube videos over the network; this port embeds a page made in code,
// so a held picture needs no network and repeats. The example's drag blocker is not part of this
// port, which draws a fixed camera with no controls.
import type { Vec3 } from '@null3d/engine';

/** The example's camera: its lens and place. */
export const CAMERA = { fov: 50, near: 1, far: 5000, position: [500, 350, 750] as Vec3 };

/** The size of an embedded page, in CSS pixels, which are the scene's units here. */
export const SCREEN = { width: 480, height: 360 };

/** How far a screen stands from the ring's centre, as the example places them. */
const RING = 240;

/** One screen of the ring: its place and its turn about the y axis. */
export interface Screen {
	readonly position: Vec3;
	readonly turn: number;
}

/** The example's four screens: front, right, back and left. */
export const SCREENS: readonly Screen[] = [
	{ position: [0, 0, RING], turn: 0 },
	{ position: [RING, 0, 0], turn: Math.PI / 2 },
	{ position: [0, 0, -RING], turn: Math.PI },
	{ position: [-RING, 0, 0], turn: -Math.PI / 2 },
];

/** The page that a screen shows, as markup: a still video card, made in code. A page sets it as the
 * iframe's `srcdoc`, so the frame keeps the page's origin and its isolation headers. */
export function videoPage(index: number): string {
	const tones = [
		['#2b0f3a', '#7a2f9e'],
		['#0d2b3a', '#2f8f9e'],
		['#3a1a0d', '#c46a2a'],
		['#12240d', '#4f9e2f'],
	];
	const [dark, light] = tones[index % tones.length] as [string, string];
	const html = [
		'<!doctype html><html><head><meta charset="utf-8"><style>',
		'html,body{height:100%}',
		`body{margin:0;display:grid;place-items:center;background:linear-gradient(160deg,${dark},${light});`,
		'color:#fff;font-family:Helvetica,Arial,sans-serif}',
		'div{text-align:center}',
		'span{display:grid;place-items:center;width:120px;height:120px;margin:0 auto 18px;',
		'border:5px solid rgba(255,255,255,0.9);border-radius:50%;font-size:44px;padding-left:14px;box-sizing:border-box}',
		'p{margin:0;font-size:26px;letter-spacing:3px}',
		'</style></head><body><div><span>&#9654;</span><p>VIDEO ',
		String(index + 1),
		'</p></div></body></html>',
	].join('');
	return html;
}

/** The element of a screen: the example's black div around an iframe, sized to the screen. */
export function screenElement(index: number): HTMLDivElement {
	const element = document.createElement('div');
	element.style.width = `${SCREEN.width}px`;
	element.style.height = `${SCREEN.height}px`;
	element.style.backgroundColor = '#000';
	const frame = document.createElement('iframe');
	frame.style.width = `${SCREEN.width}px`;
	frame.style.height = `${SCREEN.height}px`;
	frame.style.border = '0';
	frame.style.pointerEvents = 'auto';
	frame.addEventListener('load', () => {
		frame.dataset.loaded = '1';
	});
	frame.srcdoc = videoPage(index);
	element.append(frame);
	return element;
}
