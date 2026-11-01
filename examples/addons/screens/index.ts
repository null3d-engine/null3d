// Displays in the world, drawn on OffscreenCanvas objects in the sketch. A screen holds one
// canvas-backed texture, reads the canvas at its own refresh rate, and uploads only the
// rectangles that changed. The LCD material draws the panel's structure by distance: sub-pixels,
// a scan band, the gaps between texel rows, dead texels and a boot glitch. A click on the screen
// maps back to the canvas's own coordinates, so the sketch draws at the point that was clicked.
import type {
	CanvasRect,
	Material,
	Mesh,
	ObjectPointerEvent,
	SketchContext,
	Texture,
} from '@null3d/engine';
import { canvasPointAt, canvasTexelAt, type ScreenPoint } from './map';
import screenShader from './screen.wgsl';

export { canvasPointAt, canvasTexelAt, type ScreenPoint } from './map';

/** The LCD look of a screen. A value that a call leaves out keeps its default. */
export interface LcdLook {
	/**
	 * How strongly each texel shows its red, green and blue bars up close, from 0 for none to 1.
	 * Further away the bars blur into the texel's own color. The default is 0.6.
	 */
	subpixels?: number;
	/**
	 * How strongly the drifting band of light and the dark gaps between texel rows show, from 0 for
	 * none to 1. The default is 0.45.
	 */
	scan?: number;
	/**
	 * The share of the texels that stay dark, from 0 for none. The same texels stay dark on every
	 * frame. The default is 0.0015.
	 */
	deadPixels?: number;
	/** How brightly the panel glows, before the scene's tone curve. The default is 1.4. */
	glow?: number;
	/** How long the boot glitch lasts, in seconds. The default is 0.9. */
	bootSeconds?: number;
}

/** What `createScreen` takes. */
export interface ScreenOptions {
	/** The canvas's width in texels. The default is 512. */
	width?: number;
	/** The canvas's height in texels. The default is 256. */
	height?: number;
	/**
	 * The most times per second that the engine reads the canvas. A paint that comes sooner waits,
	 * and its rectangle joins the next read. The default is 12.
	 */
	refreshHz?: number;
	/**
	 * The screen's size in meters, as `[width, height]`. The default keeps the canvas's shape at one
	 * meter across.
	 */
	size?: readonly [number, number];
	/** The LCD look, or `false` for a plain image with no panel structure. The default has the look. */
	lcd?: LcdLook | false;
	/**
	 * Draws the first picture. It runs in the setup, before the first upload, so a held frame shows
	 * the picture: a held frame runs no update. Give it the whole picture, and leave the changes to
	 * `paint` or `mark`.
	 */
	draw?: (context: OffscreenCanvasRenderingContext2D) => void;
}

/** The values of the LCD look that a made screen takes, and its power. */
export interface ScreenValues extends LcdLook {
	/** The panel's power, from 0 for off to 1 for full. The default is 1. */
	power?: number;
}

/** The LCD look that a screen starts with. */
const DEFAULT_LOOK: Required<LcdLook> = {
	subpixels: 0.6,
	scan: 0.45,
	deadPixels: 0.0015,
	glow: 1.4,
	bootSeconds: 0.9,
};

/** A rectangle of a screen's canvas that changed, kept as its edges while changes join it. */
interface PendingRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** One display in the world, and the canvas that paints it. */
export interface Screen {
	/** The canvas to draw on, in its own texels. */
	readonly canvas: OffscreenCanvas;
	/** The canvas's 2D context. Draw here, then paint or mark the rectangle that changed. */
	readonly context: OffscreenCanvasRenderingContext2D;
	/** The texture that follows the canvas. */
	readonly texture: Texture;
	/** The material that draws the panel, lit or plain. */
	readonly material: Material;
	/** The plane that shows the screen, at the origin. Move it into place. */
	readonly mesh: Mesh;
	/** The canvas's width and height in texels. */
	readonly width: number;
	readonly height: number;
	/**
	 * Draws into the canvas, then uploads the rectangle that the drawing changed. With no rectangle,
	 * the whole canvas uploads. A rectangle outside the canvas clamps to it, and fractions round
	 * outwards, so a text box's measured bounds fit as they are. The upload happens in the texture's
	 * turn, within the frame's upload budget, and a refresh rate that just read the canvas holds it
	 * for the next paint.
	 */
	paint(
		draw: (context: OffscreenCanvasRenderingContext2D) => void,
		changed?: CanvasRect | readonly CanvasRect[],
	): void;
	/** Adds a rectangle that changed to the next upload, without drawing. */
	mark(rect: CanvasRect): void;
	/**
	 * Uploads the rectangle that the marks so far joined. Returns true when the engine read the
	 * canvas, and false when the refresh rate or an upload still in flight holds it; the change
	 * stays for the next call. A paint already calls it.
	 */
	flush(): boolean;
	/** Where on the canvas a pointer event hit the screen, or null when the hit has no coordinates. */
	pointOf(event: ObjectPointerEvent): ScreenPoint | null;
	/** Where in whole texels a pointer event hit the screen, or null for a hit without coordinates. */
	texelOf(event: ObjectPointerEvent): ScreenPoint | null;
	/**
	 * Runs the boot glitch from the given sketch time, which the default takes from the sketch's
	 * clock now. The panel's picture tears and rolls for the look's boot time, then settles.
	 */
	boot(at?: number): void;
	/** Changes the LCD look and the power. Throws for a screen that a call made without the look. */
	set(values: ScreenValues): void;
	/** Stops an `onClick` handler. */
	offClick(handler: (point: ScreenPoint, event: ObjectPointerEvent) => void): void;
	/**
	 * Runs a handler for each click on the screen, with the point on the canvas that was clicked.
	 * A click that the screen's surface does not cover, such as one on a hole in its mesh, runs
	 * nothing. A pointer hit has no coordinates where the mesh lacks them.
	 */
	onClick(handler: (point: ScreenPoint, event: ObjectPointerEvent) => void): void;
	/** Frees the texture, the material and the mesh. */
	destroy(): void;
}

/** A whole number of texels, at least 1. */
function texels(value: number, call: string, name: string): number {
	const whole = Math.round(value);
	if (!(whole >= 1))
		throw new Error(`${call}() got ${value} for ${name}. Give it at least 1 texel.`);
	return whole;
}

/**
 * Makes a display in the world. Paint the canvas in the sketch's setup, since a held frame runs no
 * update. Give the plane a size in meters, then move and turn `screen.mesh` into place. A second
 * screen is a second call: each has its own canvas, texture, refresh rate and look.
 */
export function createScreen(ctx: SketchContext, options: ScreenOptions = {}): Screen {
	const call = 'createScreen';
	const width = texels(options.width ?? 512, call, 'width');
	const height = texels(options.height ?? 256, call, 'height');
	const refreshHz = options.refreshHz ?? 12;
	if (!(refreshHz >= 0))
		throw new Error(`${call}() got ${refreshHz} for refreshHz. Give 0 or more.`);
	const [across, down] = options.size ?? [1, height / width];
	if (!(across > 0) || !(down > 0))
		throw new Error(`${call}() got the size ${across} x ${down}. Give two lengths above 0.`);

	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error(`${call}() found no 2D context on its canvas.`);
	// The first picture uploads with the texture, before a refresh rate can hold it back.
	options.draw?.(context);
	const texture = ctx.textures.fromCanvas(canvas, { refreshHz });
	const look = options.lcd === false ? null : { ...DEFAULT_LOOK, ...options.lcd };
	const lcd = look
		? ctx.materials.shader({
				wgsl: screenShader,
				textures: { screen: texture },
				uniforms: {
					resolution: [width, height],
					glow: look.glow,
					power: 1,
					subpixels: look.subpixels,
					scan: look.scan,
					dead: look.deadPixels,
					bootAt: ctx.time.now,
					bootSeconds: look.bootSeconds,
				},
			})
		: null;
	const material: Material = lcd ?? ctx.materials.unlit({ map: texture });
	const mesh = ctx.scene.createMesh({
		mesh: ctx.geometry.plane({ width: across, height: down }),
		material,
	});

	// The rectangles that still have to upload, joined as the canvas changes.
	let pending: PendingRect | null = null;
	const mark = (rect: CanvasRect): void => {
		const left = Math.max(0, Math.min(width, Math.floor(rect.x)));
		const top = Math.max(0, Math.min(height, Math.floor(rect.y)));
		const right = Math.max(left, Math.min(width, Math.ceil(rect.x + rect.width)));
		const bottom = Math.max(top, Math.min(height, Math.ceil(rect.y + rect.height)));
		if (right <= left || bottom <= top) return;
		if (!pending) pending = { left, top, right, bottom };
		else {
			pending.left = Math.min(pending.left, left);
			pending.top = Math.min(pending.top, top);
			pending.right = Math.max(pending.right, right);
			pending.bottom = Math.max(pending.bottom, bottom);
		}
	};
	const flush = (): boolean => {
		if (!pending) return false;
		// The engine keeps the rectangle itself while a refresh rate or an upload holds it back, so
		// a read that did not happen leaves the marks here for the next call.
		const sent = texture.refresh({
			x: pending.left,
			y: pending.top,
			width: pending.right - pending.left,
			height: pending.bottom - pending.top,
		});
		if (sent) pending = null;
		return sent;
	};
	const paint = (
		draw: (context: OffscreenCanvasRenderingContext2D) => void,
		changed?: CanvasRect | readonly CanvasRect[],
	): void => {
		draw(context);
		if (changed === undefined) mark({ x: 0, y: 0, width, height });
		else if ('x' in changed) mark(changed);
		else for (const rect of changed) mark(rect);
		flush();
	};
	const pointOf = (event: ObjectPointerEvent): ScreenPoint | null =>
		event.hasUv ? canvasPointAt(event.uv, width, height) : null;
	const texelOf = (event: ObjectPointerEvent): ScreenPoint | null =>
		event.hasUv ? canvasTexelAt(event.uv, width, height) : null;
	const listeners = new Map<
		(point: ScreenPoint, event: ObjectPointerEvent) => void,
		(event: ObjectPointerEvent) => void
	>();
	const onClick = (handler: (point: ScreenPoint, event: ObjectPointerEvent) => void): void => {
		const listener = (event: ObjectPointerEvent): void => {
			const point = pointOf(event);
			if (point) handler(point, event);
		};
		listeners.set(handler, listener);
		mesh.on('click', listener);
	};
	const offClick = (handler: (point: ScreenPoint, event: ObjectPointerEvent) => void): void => {
		const listener = listeners.get(handler);
		if (!listener) return;
		mesh.off('click', listener);
		listeners.delete(handler);
	};
	const boot = (at: number = ctx.time.now): void => {
		lcd?.setUniform('bootAt', at);
	};
	const set = (values: ScreenValues): void => {
		if (!lcd)
			throw new Error(
				`${call}() made this screen with the plain look, which takes no values. Make it with the LCD look to change it.`,
			);
		if (values.subpixels !== undefined) lcd.setUniform('subpixels', values.subpixels);
		if (values.scan !== undefined) lcd.setUniform('scan', values.scan);
		if (values.deadPixels !== undefined) lcd.setUniform('dead', values.deadPixels);
		if (values.glow !== undefined) lcd.setUniform('glow', values.glow);
		if (values.bootSeconds !== undefined) lcd.setUniform('bootSeconds', values.bootSeconds);
		if (values.power !== undefined) lcd.setUniform('power', values.power);
	};
	const destroy = (): void => {
		for (const [, listener] of listeners) mesh.off('click', listener);
		listeners.clear();
		mesh.destroy();
		material.destroy();
		texture.destroy();
	};

	return {
		canvas,
		context,
		texture,
		material,
		mesh,
		width,
		height,
		paint,
		mark,
		flush,
		pointOf,
		texelOf,
		boot,
		set,
		onClick,
		offClick,
		destroy,
	};
}
