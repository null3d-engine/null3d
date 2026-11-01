// The messages that carry a video's frames from the page to the sketch. `engine.registerVideo`
// follows a video element on the page, which is the only thread that has one, and the sketch shows
// it with `textures.fromVideo`. The sketch asks for the frames, so a video that nothing shows costs
// nothing, and a paused video presents no frames, so neither does its texture.
//
// Both names are the engine's own: the sketch takes the frames before its message handlers see
// them, and the page takes the ask before its handlers see it.

/** The page's message that carries a video's newest frame to the sketch, under the video's name. */
export const VIDEO_FRAME = 'null3d:video-frame';

/** The sketch's message that asks the page for a video's frames, or stops them. */
export const VIDEO_FOLLOW = 'null3d:video-follow';

/** A video's frame, as the page sends it: the video's name, and the image of the frame. */
export interface VideoFrameMessage {
	readonly name: string;
	readonly image: ImageBitmap;
}

/** A video that the sketch follows, or stops following, by name. */
export interface VideoFollowMessage {
	readonly name: string;
	/** True to send the video's frames, and false to stop them. */
	readonly follow: boolean;
}
