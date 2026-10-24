import { afterEach, describe, expect, it } from 'bun:test';
import { VIDEO_FRAME, type VideoFrameMessage } from '../shared/videos';
import { PageVideos } from './videos';

/**
 * A video element as the page's video code reads one: the frames that it presents, and the request
 * for the next one, which a browser answers when it presents that frame.
 */
function fakeVideo(width = 640, height = 360) {
	const waiting = new Map<number, () => void>();
	const listeners = new Map<string, Set<() => void>>();
	let next = 0;
	const video = {
		videoWidth: width,
		videoHeight: height,
		readyState: 4,
		currentTime: 0,
		paused: false,
		addEventListener(type: string, listener: () => void) {
			let set = listeners.get(type);
			if (!set) {
				set = new Set();
				listeners.set(type, set);
			}
			set.add(listener);
		},
		removeEventListener(type: string, listener: () => void) {
			listeners.get(type)?.delete(listener);
		},
		/** Sends the event that a video plays, or that it moved to another time, to its listeners. */
		emit(type: string) {
			for (const listener of listeners.get(type) ?? []) listener();
		},
		/** How many listeners of one event the video holds. */
		listening(type: string) {
			return listeners.get(type)?.size ?? 0;
		},
		requestVideoFrameCallback(callback: () => void) {
			waiting.set(++next, callback);
			return next;
		},
		cancelVideoFrameCallback(id: number) {
			waiting.delete(id);
		},
		/** Presents the next frame of the video: its media time moves, then its callback runs. */
		present(seconds = 1 / 30) {
			video.currentTime += seconds;
			for (const [id, callback] of [...waiting]) {
				waiting.delete(id);
				callback();
			}
		},
		/** How many requests for a frame wait for the next one. */
		get waiting() {
			return waiting.size;
		},
	};
	return video;
}

/** A video element of a browser without `requestVideoFrameCallback`, which presents on a display frame. */
function oldVideo(width = 640, height = 360) {
	const {
		requestVideoFrameCallback: _request,
		cancelVideoFrameCallback: _cancel,
		...video
	} = fakeVideo(width, height);
	return video;
}

/** An image that the browser's `createImageBitmap` gives the page, and that says when it closed. */
function decoded(width: number, height: number) {
	const image = {
		width,
		height,
		closed: false,
		close() {
			image.closed = true;
		},
	};
	return image as unknown as ImageBitmap & { closed: boolean };
}

const REAL_CREATE = globalThis.createImageBitmap;
const REAL_ANIMATION_FRAME = globalThis.requestAnimationFrame;

afterEach(() => {
	if (REAL_CREATE) globalThis.createImageBitmap = REAL_CREATE;
	else Reflect.deleteProperty(globalThis, 'createImageBitmap');
	if (REAL_ANIMATION_FRAME) globalThis.requestAnimationFrame = REAL_ANIMATION_FRAME;
	else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
	Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
});

/**
 * Stands in for the browser's `createImageBitmap`, which gives an image of the size that the page
 * asked for, and records each ask. `answer` holds the image back, for a test of a frame that comes
 * while another waits.
 */
function stubImages(answer?: (options: ImageBitmapOptions) => Promise<ImageBitmap>) {
	const asked: ImageBitmapOptions[] = [];
	globalThis.createImageBitmap = ((
		_source: unknown,
		options?: ImageBitmapOptions,
	): Promise<ImageBitmap> => {
		asked.push(options ?? {});
		if (answer) return answer(options ?? {});
		return Promise.resolve(decoded(options?.resizeWidth ?? 1, options?.resizeHeight ?? 1));
	}) as typeof createImageBitmap;
	return asked;
}

/** Runs the promise callbacks of the frame's image, which no test awaits from the page's side. */
async function settle(): Promise<void> {
	for (let tick = 0; tick < 4; tick++) await Promise.resolve();
}

/** Stands in for the display's frames, which a test runs one at a time. */
function stubFrames() {
	const frames: (() => void)[] = [];
	globalThis.requestAnimationFrame = ((callback: () => void) => {
		frames.push(callback);
		return frames.length;
	}) as typeof requestAnimationFrame;
	Reflect.set(globalThis, 'cancelAnimationFrame', () => {});
	return frames;
}

/** The page's videos with a recorder of the messages that they send the sketch. */
function stage() {
	const posts: [string, VideoFrameMessage | unknown, Transferable[] | undefined][] = [];
	const videos = new PageVideos((name, data, transfer) => posts.push([name, data, transfer]));
	return { videos, posts };
}

describe('engine.registerVideo', () => {
	it('sends the frame that the video shows when the sketch asks, and one for each frame after it', async () => {
		const asked = stubImages();
		const { videos, posts } = stage();
		const video = fakeVideo(640, 360);
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		// A video that no texture shows costs nothing.
		expect(posts).toEqual([]);
		videos.follow('intro', true);
		await settle();
		expect(posts.length).toBe(1);
		expect(posts[0]?.[0]).toBe(VIDEO_FRAME);
		const first = posts[0]?.[1] as VideoFrameMessage;
		expect(first.name).toBe('intro');
		// The frame takes the widest side that the options allow, with the video's shape.
		expect(asked[0]).toEqual({ resizeWidth: 512, resizeHeight: 288, imageOrientation: 'flipY' });
		expect(posts[0]?.[2]).toEqual([first.image]);
		video.present();
		await settle();
		expect(posts.length).toBe(2);
	});

	it('leaves a frame that is smaller than the widest side as it is', async () => {
		const asked = stubImages();
		const { videos } = stage();
		const video = fakeVideo(320, 240);
		videos.register(video as unknown as HTMLVideoElement, { name: 'small' });
		videos.follow('small', true);
		await settle();
		expect(asked[0]).toEqual({ resizeWidth: 320, resizeHeight: 240, imageOrientation: 'flipY' });
	});

	it('sends nothing while the video presents no frame, as a paused video does not', async () => {
		stubImages();
		const { videos, posts } = stage();
		const video = fakeVideo();
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		videos.follow('intro', true);
		await settle();
		expect(posts.length).toBe(1);
		// A paused video presents no frame, so its request waits and costs nothing.
		expect(video.waiting).toBe(1);
		await settle();
		expect(posts.length).toBe(1);
	});

	it('sends nothing for a video without a frame yet, and the frame once it has one', async () => {
		stubImages();
		const { videos, posts } = stage();
		const video = fakeVideo();
		video.readyState = 0;
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		videos.follow('intro', true);
		await settle();
		expect(posts).toEqual([]);
		video.readyState = 4;
		video.present();
		await settle();
		expect(posts.length).toBe(1);
	});

	it('sends no frame sooner than the frame rate allows', async () => {
		stubImages();
		const { videos, posts } = stage();
		const video = fakeVideo();
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro', frameRate: 0.001 });
		videos.follow('intro', true);
		await settle();
		expect(posts.length).toBe(1);
		video.present();
		await settle();
		expect(posts.length).toBe(1);
	});

	it('sends one frame at a time, so a slow image of one frame skips the frames after it', async () => {
		let release = (_image: ImageBitmap) => {};
		const held = new Promise<ImageBitmap>((resolve) => {
			release = resolve;
		});
		stubImages(() => held);
		const { videos, posts } = stage();
		const video = fakeVideo();
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		videos.follow('intro', true);
		video.present();
		await settle();
		expect(posts).toEqual([]);
		release(decoded(512, 288));
		await settle();
		expect(posts.length).toBe(1);
	});

	it('warns once when the browser refuses a frame, as a video of another origin does', async () => {
		stubImages(() => Promise.reject(new Error('SecurityError')));
		const warnings: unknown[][] = [];
		const realWarn = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args);
		const { videos, posts } = stage();
		const video = fakeVideo();
		try {
			videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
			videos.follow('intro', true);
			await settle();
			video.present();
			await settle();
		} finally {
			console.warn = realWarn;
		}
		expect(posts).toEqual([]);
		expect(warnings.length).toBe(1);
		expect(String(warnings[0]?.[0])).toContain('CORS');
	});

	it('stops the frames when the sketch stops following the video, and sends the shown frame again', async () => {
		stubImages();
		const { videos, posts } = stage();
		const video = fakeVideo();
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		videos.follow('intro', true);
		await settle();
		expect(posts.length).toBe(1);
		videos.follow('intro', false);
		expect(video.waiting).toBe(0);
		video.present();
		await settle();
		expect(posts.length).toBe(1);
		// The frame that the video shows then is the one that the next ask sends.
		videos.follow('intro', true);
		await settle();
		expect(posts.length).toBe(2);
	});

	it('closes a frame that its image finishes after the sketch stopped following the video', async () => {
		let release = (_image: ImageBitmap) => {};
		const held = new Promise<ImageBitmap>((resolve) => {
			release = resolve;
		});
		stubImages(() => held);
		const { videos, posts } = stage();
		const video = fakeVideo();
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		videos.follow('intro', true);
		videos.follow('intro', false);
		const image = decoded(512, 288);
		release(image);
		await settle();
		expect(posts).toEqual([]);
		expect(image.closed).toBe(true);
	});

	it('stops the frames of a video that the page registers no more', async () => {
		stubImages();
		const { videos, posts } = stage();
		const video = fakeVideo();
		const stop = videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		videos.follow('intro', true);
		await settle();
		stop();
		expect(video.waiting).toBe(0);
		video.present();
		videos.follow('intro', true);
		await settle();
		expect(posts.length).toBe(1);
	});

	it('stops every video when the engine stops', async () => {
		stubImages();
		const { videos, posts } = stage();
		const video = fakeVideo();
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		videos.follow('intro', true);
		await settle();
		videos.dispose();
		expect(video.waiting).toBe(0);
		video.present();
		await settle();
		expect(posts.length).toBe(1);
	});

	it('sends a frame for each new media time where the browser has no video callback', async () => {
		stubImages();
		const frames = stubFrames();
		const { videos, posts } = stage();
		const video = oldVideo();
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		videos.follow('intro', true);
		await settle();
		expect(posts.length).toBe(1);
		// A display frame that shows the same media time sends nothing.
		frames.shift()?.();
		await settle();
		expect(posts.length).toBe(1);
		// A frame that the video presents sends one.
		video.currentTime += 1 / 30;
		frames.shift()?.();
		await settle();
		expect(posts.length).toBe(2);
	});

	it('sends a frame on a display frame where the browser reports none for a hidden video', async () => {
		stubImages();
		const frames = stubFrames();
		const { videos, posts } = stage();
		const video = fakeVideo();
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		videos.follow('intro', true);
		await settle();
		expect(posts.length).toBe(1);
		// The browser presents the video's frames to no one, so its callback never runs.
		expect(video.waiting).toBe(1);
		video.currentTime += 1 / 30;
		frames.shift()?.();
		await settle();
		expect(posts.length).toBe(2);
	});

	it('waits while the video is paused, and starts again when it plays', async () => {
		stubImages();
		const frames = stubFrames();
		const { videos, posts } = stage();
		const video = fakeVideo();
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		videos.follow('intro', true);
		await settle();
		expect(posts.length).toBe(1);
		// A paused video leaves no display frame waiting.
		video.paused = true;
		frames.shift()?.();
		expect(frames.length).toBe(0);
		video.currentTime += 2;
		// The video plays again, and the frame that it shows is the texture's.
		video.paused = false;
		video.emit('play');
		await settle();
		expect(posts.length).toBe(2);
		// A seek sends the frame that the video shows too.
		video.currentTime += 5;
		video.emit('seeked');
		await settle();
		expect(posts.length).toBe(3);
	});

	it('stops the video events when the page registers a video no more', async () => {
		stubImages();
		stubFrames();
		const { videos } = stage();
		const video = fakeVideo();
		const stop = videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		expect(video.listening('play')).toBe(1);
		stop();
		expect(video.listening('play')).toBe(0);
		expect(video.listening('seeked')).toBe(0);
	});

	it('throws E1213 for a name that another video holds, and for an option out of range', () => {
		stubImages();
		const { videos } = stage();
		const video = fakeVideo();
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		expect(() => videos.register(video as unknown as HTMLVideoElement, { name: 'intro' })).toThrow(
			'which another video holds',
		);
		expect(() => videos.register(fakeVideo() as unknown as HTMLVideoElement, { name: '' })).toThrow(
			'Give a name of at least one character',
		);
		expect(() =>
			videos.register(video as unknown as HTMLVideoElement, { name: 'big', maxSize: 8192 }),
		).toThrow('maxSize');
		expect(() =>
			videos.register(video as unknown as HTMLVideoElement, { name: 'fast', frameRate: -1 }),
		).toThrow('frameRate');
		expect(() => videos.register({} as HTMLVideoElement, { name: 'bare' })).toThrow(
			'other than a video element',
		);
	});

	it('sends the frames of a video that the sketch followed before the page registered it', async () => {
		stubImages();
		const { videos, posts } = stage();
		const video = fakeVideo();
		// The sketch's setup asks for the frames before the page calls registerVideo.
		videos.follow('intro', true);
		videos.register(video as unknown as HTMLVideoElement, { name: 'intro' });
		await settle();
		expect(posts.length).toBe(1);
		video.present();
		await settle();
		expect(posts.length).toBe(2);
	});

	it('follows no video that the page never registered', async () => {
		stubImages();
		const { videos, posts } = stage();
		videos.follow('gone', true);
		await settle();
		expect(posts).toEqual([]);
	});
});
