// The page's side of video textures: `engine.registerVideo` follows a video element, which lives on
// the page and nowhere else, and sends each frame that the video presents to the sketch, where
// `textures.fromVideo` shows it. The sketch asks for the frames, so a video that no texture shows
// costs nothing, and the page sends a frame only when the video presents a new one, so a paused
// video costs nothing either. A frame is one ImageBitmap of the video at the size that the options
// allow, which the sketch uploads in its turn and the engine closes once it is on the GPU.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { messageOf } from '../errors/message';
import { VIDEO_FRAME, type VideoFrameMessage } from '../shared/videos';

/**
 * What `engine.registerVideo` takes: the name that the sketch follows the video by, the most texels
 * a frame may hold, and how often the page sends frames.
 *
 * @category api/engine
 */
export interface VideoOptions {
	/** The video's name, which the sketch's `textures.fromVideo` takes. */
	name: string;
	/**
	 * The most texels of the frame's widest or tallest side. The page scales each frame down to it,
	 * with the video's shape, and leaves a frame that is smaller as it is. The default is 512: a
	 * 16:9 frame of that width is 512 x 288 texels, which is 576 KiB, so one frame fits the Low
	 * preset's 2 MiB upload budget whole. A frame of 1,024 texels a side is 4 MiB, which a phone's
	 * Low preset uploads over two frames. Keep it within the sketch's `textures.maxSize`, the
	 * largest texture that the device takes.
	 */
	maxSize?: number;
	/**
	 * The most frames a second that the page sends, as an upper limit: a call that comes sooner
	 * sends nothing. The default is 0, which sends each frame that the video presents.
	 */
	frameRate?: number;
}

/** The default widest side of a frame, in texels: 576 KiB of RGBA texels for a 16:9 video. */
const DEFAULT_MAX_SIZE = 512;

/**
 * The largest `maxSize`: 4,096 texels, the smallest largest texture that every device that the
 * engine runs on takes.
 */
const LARGEST_MAX_SIZE = 4096;

/** One registered video, and the loop that sends its frames while the sketch follows it. */
interface Item {
	readonly name: string;
	readonly video: HTMLVideoElement;
	readonly maxSize: number;
	/** The least milliseconds between two frames, or 0 for none. */
	readonly leastMs: number;
	/** True while the sketch shows the video. */
	followed: boolean;
	/** The request for the video's next frame, or undefined while no loop runs. */
	waiting: number | undefined;
	/** How this browser cancels the request in `waiting`. */
	cancel: (id: number) => void;
	/**
	 * The request for the next display frame, while the video plays. Some browsers report no
	 * presented frame for a video element that the page does not show, so the display's frames
	 * carry the video's too: a frame whose media time has not moved sends nothing.
	 */
	ticking: number | undefined;
	/** Starts the display frames again when the video plays, or after a seek. */
	resume: () => void;
	/** True while a frame waits for its image. One frame is in flight at a time. */
	decoding: boolean;
	/** The time of the media of the last frame sent, so a display frame with no new frame sends none. */
	lastTime: number;
	/** The time of the last frame sent, in milliseconds, for the frame rate limit. */
	lastSent: number;
	/** True once a development build warned why a frame of the video could not be copied. */
	warned: boolean;
}

/**
 * The videos that the page registered, as `engine.registerVideo` gives them: each one follows its
 * video element while the sketch shows it, and sends the video's frames to the sketch.
 */
export class PageVideos {
	private readonly items = new Map<string, Item>();
	/**
	 * The names that the sketch shows, whether or not the page registered the video yet: the
	 * sketch's setup asks for its video's frames before the page registers the video.
	 */
	private readonly wanted = new Set<string>();

	/** `post` sends a message to the sketch, as `engine.postToSketch` does. */
	constructor(
		private readonly post: (name: string, data: unknown, transfer?: Transferable[]) => void,
	) {}

	/**
	 * Follows `video`, and sends the sketch the image of each frame that it presents, under the
	 * name that the options give. Returns a function that stops the frames. The sketch asks for
	 * them with `textures.fromVideo`, so a video that no texture shows sends none.
	 */
	register(video: HTMLVideoElement, options: VideoOptions): () => void {
		const call = 'engine.registerVideo';
		const { name, maxSize = DEFAULT_MAX_SIZE, frameRate = 0 } = options;
		if (DEV) {
			if (typeof name !== 'string' || name.length === 0)
				throw new EngineError(
					'E1213',
					`${call}() got ${quote(name)} as the video's name. Give a name of at least one character, and the same name to textures.fromVideo() in the sketch.`,
				);
			if (this.items.has(name))
				throw new EngineError(
					'E1213',
					`${call}() got the name "${name}", which another video holds. Give each video a name of its own.`,
				);
			if (!(video && typeof video === 'object' && 'videoWidth' in video && 'currentTime' in video))
				throw new EngineError(
					'E1213',
					`${call}() got something other than a video element for "${name}". Give it the HTMLVideoElement that plays the video.`,
				);
			if (!(Number.isInteger(maxSize) && maxSize >= 1 && maxSize <= LARGEST_MAX_SIZE))
				throw new EngineError(
					'E1213',
					`${call}() got ${maxSize} for maxSize: give a whole number of texels from 1 to ${LARGEST_MAX_SIZE}.`,
				);
			if (!(Number.isFinite(frameRate) && frameRate >= 0))
				throw new EngineError(
					'E1213',
					`${call}() got ${frameRate} for frameRate: give 0 or a positive number of frames a second.`,
				);
		}
		const item: Item = {
			name,
			video,
			maxSize,
			leastMs: frameRate > 0 ? 1000 / frameRate : 0,
			followed: false,
			waiting: undefined,
			cancel: () => {},
			ticking: undefined,
			resume: () => {},
			decoding: false,
			lastTime: Number.NaN,
			lastSent: Number.NEGATIVE_INFINITY,
			warned: false,
		};
		// A video that plays again, or that moves to another time, has a frame to send even where
		// the browser reports no presented frame for it.
		item.resume = () => {
			if (!item.followed) return;
			this.tick(item);
			this.send(item, true);
		};
		video.addEventListener('play', item.resume);
		video.addEventListener('seeked', item.resume);
		this.items.set(name, item);
		// A sketch that follows the name already asked for its frames before this call.
		if (this.wanted.has(name)) this.follow(name, true);
		return () => this.unregister(item);
	}

	/**
	 * @internal Starts or stops a video's frames, as the sketch's `textures.fromVideo` and
	 * `texture.destroy` ask. Every frame after the sketch's ask comes as the video presents it; the
	 * ask also sends the frame that the video shows then, so a video that is paused at the call
	 * still shows.
	 */
	follow(name: string, follow: boolean): void {
		if (follow) this.wanted.add(name);
		else this.wanted.delete(name);
		const item = this.items.get(name);
		if (!item) return;
		if (!follow) {
			this.stop(item);
			item.followed = false;
			return;
		}
		if (item.followed) return;
		item.followed = true;
		this.watch(item);
		this.tick(item);
		this.send(item, false);
	}

	/** @internal Stops every video's frames, for an engine that stops. */
	dispose(): void {
		for (const item of this.items.values()) this.release(item);
		this.items.clear();
		this.wanted.clear();
	}

	/** Stops following a video element, and drops it from the engine. */
	private unregister(item: Item): void {
		if (this.items.get(item.name) !== item) return;
		this.release(item);
		this.items.delete(item.name);
	}

	/** Stops a video's loops and listeners, for an item that the page holds no more. */
	private release(item: Item): void {
		this.stop(item);
		item.video.removeEventListener('play', item.resume);
		item.video.removeEventListener('seeked', item.resume);
	}

	/**
	 * Asks for the video's next presented frame, where the browser reports them. A video that the
	 * page does not show may present none, and `tick` then carries its frames.
	 */
	private watch(item: Item): void {
		const { video } = item;
		if (item.waiting !== undefined || typeof video.requestVideoFrameCallback !== 'function') return;
		// A paused video presents no frame, so its callback costs nothing while it is paused.
		item.cancel = (id) => video.cancelVideoFrameCallback?.(id);
		item.waiting = video.requestVideoFrameCallback(() => {
			item.waiting = undefined;
			if (this.items.get(item.name) !== item || !item.followed) return;
			this.watch(item);
			this.send(item, false);
		});
	}

	/**
	 * Checks each display frame while the video plays, for a browser that reports no presented
	 * frame for it. A frame whose media time has not moved sends nothing, so a display that is
	 * faster than the video sends one image for each frame of the video. The loop stops while the
	 * video is paused, and `resume` starts it again.
	 */
	private tick(item: Item): void {
		if (item.ticking !== undefined || !item.followed) return;
		if (typeof globalThis.requestAnimationFrame !== 'function') return;
		const step = () => {
			item.ticking = undefined;
			if (this.items.get(item.name) !== item || !item.followed) return;
			if (item.video.paused) return;
			this.tick(item);
			this.send(item, true);
		};
		item.ticking = globalThis.requestAnimationFrame(step);
	}

	/** Stops the loops that wait for the video's frames. */
	private stop(item: Item): void {
		if (item.waiting !== undefined) {
			item.cancel(item.waiting);
			item.waiting = undefined;
		}
		if (item.ticking !== undefined) {
			globalThis.cancelAnimationFrame?.(item.ticking);
			item.ticking = undefined;
		}
	}

	/**
	 * Sends the sketch the image of the frame that the video shows now, unless a frame still waits
	 * for its image, the frame rate skips this one, or the video shows no frame yet. With `compare`
	 * true, a media time that the frame sent before holds sends nothing, for a display frame that
	 * shows no new frame.
	 */
	private send(item: Item, compare: boolean): void {
		const { video } = item;
		if (!item.followed || item.decoding) return;
		const now = performance.now();
		if (item.leastMs > 0 && now - item.lastSent < item.leastMs) return;
		// A video without metadata or data has no frame to give yet.
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (!(width > 0) || !(height > 0) || video.readyState < 2) return;
		const time = video.currentTime;
		if (compare && time === item.lastTime) return;
		const size = fit(width, height, item.maxSize);
		item.decoding = true;
		createImageBitmap(video, {
			resizeWidth: size.width,
			resizeHeight: size.height,
			imageOrientation: 'flipY',
		}).then(
			(image) => {
				item.decoding = false;
				// A video that stopped, or one that the page registered again under its name, takes
				// no frame: the image goes back, so its memory comes back with it.
				if (!item.followed || this.items.get(item.name) !== item) {
					image.close();
					return;
				}
				item.lastTime = time;
				item.lastSent = now;
				this.post(VIDEO_FRAME, { name: item.name, image } satisfies VideoFrameMessage, [image]);
			},
			(error: unknown) => {
				item.decoding = false;
				// A frame that the browser refuses, such as one of a video from another origin
				// without its CORS headers, leaves the texture with the frame before it.
				if (DEV && !item.warned) {
					item.warned = true;
					console.warn(
						`null3D could not copy a frame of the video "${item.name}", so its texture keeps the frame before it: ${messageOf(error)} A video from another origin needs video.crossOrigin = 'anonymous' and the server's CORS headers.`,
					);
				}
			},
		);
	}
}

/**
 * The frame's size in texels: the video's own size where it fits `maxSize`, and the size that
 * keeps the video's shape where it does not.
 */
function fit(width: number, height: number, maxSize: number): { width: number; height: number } {
	if (width <= maxSize && height <= maxSize) return { width, height };
	const scale = maxSize / Math.max(width, height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

const quote = (value: unknown) => (typeof value === 'string' ? `'${value}'` : String(value));
