// The scene of three.js's CSS3D sprites example (examples/css3d_sprites.html, r186): 512 billboarded
// images that move between four formations, a plane, a cube, a scatter and a sphere, and shimmer in
// scale as they go. The example picks its scatter and each move's length with `Math.random()`, which
// a held picture cannot repeat; this port takes both from an integer hash of the sprite's place and
// of the move, so the null3D sketch and three.js's twin draw the same frame.
import type { Vec3 } from '@null3d/engine';
import { unit } from './css3d-shared';

/** The example's camera: its lens and place. */
export const CAMERA = { fov: 75, near: 1, far: 5000, position: [600, 400, 1500] as Vec3 };

/** The sprites' number, as the example counts them. */
export const SPRITES = 512;

/** How long a formation holds before the next move starts, in seconds. */
const CYCLE = 6;
/** The shortest and longest move to a formation, in seconds. */
const MOVE = [2, 4] as const;

/** The plane's layout, as the example lays it out. */
function plane(index: number): Vec3 {
	const amountX = 16;
	const separation = 150;
	const offsetX = ((amountX - 1) * separation) / 2;
	const offsetZ = ((SPRITES / amountX - 1) * separation) / 2;
	const x = (index % amountX) * separation;
	const z = Math.floor(index / amountX) * separation;
	const y = (Math.sin(x * 0.5) + Math.sin(z * 0.5)) * 200;
	return [x - offsetX, y, z - offsetZ];
}

/** The cube's layout, as the example lays it out. */
function cube(index: number): Vec3 {
	const amount = 8;
	const separation = 150;
	const offset = ((amount - 1) * separation) / 2;
	const x = (index % amount) * separation;
	const y = (Math.floor(index / amount) % amount) * separation;
	const z = Math.floor(index / (amount * amount)) * separation;
	return [x - offset, y - offset, z - offset];
}

/** The sphere's layout, as the example lays it out. */
function sphere(index: number): Vec3 {
	const radius = 750;
	const phi = Math.acos(-1 + (2 * index) / SPRITES);
	const theta = Math.sqrt(SPRITES * Math.PI) * phi;
	return [
		radius * Math.cos(theta) * Math.sin(phi),
		radius * Math.sin(theta) * Math.sin(phi),
		radius * Math.cos(phi),
	];
}

/** A scatter, which the example fills from `Math.random()` and this port from the hash of `salt`. */
function scatter(salt: number): Vec3[] {
	return Array.from({ length: SPRITES }, (_unused, index) => [
		unit(index, salt) * 4000 - 2000,
		unit(index, salt + 1) * 4000 - 2000,
		unit(index, salt + 2) * 4000 - 2000,
	]);
}

/** The four formations, in the order that the example moves through them. */
export const FORMATIONS: readonly (readonly Vec3[])[] = [
	Array.from({ length: SPRITES }, (_unused, index) => plane(index)),
	Array.from({ length: SPRITES }, (_unused, index) => cube(index)),
	scatter(100),
	Array.from({ length: SPRITES }, (_unused, index) => sphere(index)),
];

/** Where the sprites start, before the first move to the plane. */
const START = scatter(200);

/** The example's exponential ease in and out, which each move uses. */
function ease(t: number): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	return t < 0.5 ? 0.5 * 2 ** (20 * t - 10) : -0.5 * 2 ** (-20 * t + 10) + 1;
}

/** How long sprite `index` takes to reach the formation of `cycle`, in seconds. */
function moveTime(index: number, cycle: number): number {
	return MOVE[0] + unit(index, 300 + cycle) * (MOVE[1] - MOVE[0]);
}

/** The formation that sprite `index` moves to in `cycle`, and the one it leaves. */
function endsOf(index: number, cycle: number): [Vec3, Vec3] {
	const to = FORMATIONS[cycle % FORMATIONS.length]?.[index] as Vec3;
	const from =
		cycle === 0
			? (START[index] as Vec3)
			: (FORMATIONS[(cycle - 1) % FORMATIONS.length]?.[index] as Vec3);
	return [from, to];
}

/** Where sprite `index` sits at sketch time `time`, in seconds. */
export function spritePosition(index: number, time: number): Vec3 {
	const cycle = Math.floor(time / CYCLE);
	const elapsed = time - cycle * CYCLE;
	const [from, to] = endsOf(index, cycle);
	const u = ease(elapsed / moveTime(index, cycle));
	return [
		(from[0] as number) + ((to[0] as number) - (from[0] as number)) * u,
		(from[1] as number) + ((to[1] as number) - (from[1] as number)) * u,
		(from[2] as number) + ((to[2] as number) - (from[2] as number)) * u,
	];
}

/**
 * The scale of sprite `index` at sketch time `time`, in seconds: the example's shimmer, whose phase
 * comes from the sprite's place and from the clock. The example reads the page's clock, which a held
 * frame cannot repeat, so this port reads the sketch's clock.
 */
export function spriteScale(position: Vec3, time: number): number {
	return Math.sin((Math.floor(position[0]) + time * 1000) * 0.002) * 0.3 + 1;
}

/** The element of a sprite: the example's own image, drawn in code so no file is loaded. */
export function spriteImage(): HTMLImageElement {
	const image = document.createElement('img');
	image.src = spriteSource();
	return image;
}

let source: string | undefined;

/** A dark glossy ball with a highlight, as the example's sprite image, as a data URL. */
function spriteSource(): string {
	if (source !== undefined) return source;
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 128;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('the page lacks a 2D canvas');
	context.save();
	context.beginPath();
	context.arc(64, 64, 62, 0, Math.PI * 2);
	context.clip();
	// The ball's body darkens toward its rim.
	const body = context.createRadialGradient(64, 64, 5, 64, 64, 64);
	body.addColorStop(0, '#262b33');
	body.addColorStop(0.7, '#0c0f14');
	body.addColorStop(1, '#010203');
	context.fillStyle = body;
	context.fillRect(0, 0, 128, 128);
	// The specular highlight sits up and to the left, as the example's image shows.
	const shine = context.createRadialGradient(46, 38, 1, 46, 38, 36);
	shine.addColorStop(0, 'rgba(255,255,255,0.95)');
	shine.addColorStop(0.35, 'rgba(205,228,245,0.38)');
	shine.addColorStop(1, 'rgba(255,255,255,0)');
	context.fillStyle = shine;
	context.fillRect(0, 0, 128, 128);
	// A faint light along the lower rim rounds the ball off.
	const rim = context.createRadialGradient(64, 64, 44, 64, 64, 63);
	rim.addColorStop(0, 'rgba(150,190,220,0)');
	rim.addColorStop(1, 'rgba(150,190,220,0.22)');
	context.fillStyle = rim;
	context.fillRect(0, 0, 128, 128);
	context.restore();
	source = canvas.toDataURL();
	return source;
}
