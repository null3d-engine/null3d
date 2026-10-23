# D-232: Video textures follow a video element on the page

Status: decided. Date: 23 October 2026. Task: M3-F6. The cost of a frame on each GPU path, and the two browsers' support for `createImageBitmap` from a video element, are owed until test T-30 runs on this Mac.

Summary: A video element stays on the page, which has the only thread that can decode it. `engine.registerVideo` sends the sketch one `ImageBitmap` per frame the video presents, scaled to 512 texels on its widest side by default, and `textures.fromVideo` uploads the newest frame within the frame's upload budget. A 512 by 288 frame is 576 KiB, so it fits the Low preset's 2 MiB budget whole, and a paused video, or one that no texture shows, costs nothing.

## Question

How does a sketch show a video on a surface? Which thread reads the video's frames, in what form do they cross to the sketch, and what keeps the cost within the upload budget?

## Rule

A video at 512 texels on its widest side plays at 30 frames a second within the Low preset's 2 MiB upload budget, on both GPU paths and in every thread mode. A browser that cannot copy a video element into a `VideoFrame` gives the same picture. A paused video makes the engine allocate nothing and upload nothing.

## Data

| Measure | 512 by 288 frame | 1024 by 576 frame | 1920 by 1080 frame |
| --- | --- | --- | --- |
| Bytes of one frame, RGBA8 | 576 KiB | 2.25 MiB | 7.9 MiB |
| Frames that one 2 MiB budget uploads whole | 1 | 0, the frame spans 2 | 0, the frame spans 4 |
| Uploads a second at 30 frames a second | 17 MiB | 68 MiB | 237 MiB |

| Route | Chrome | Safari | Firefox |
| --- | --- | --- | --- |
| `new VideoFrame(videoElement)` then transfer | works | no support from a video element | no support from a video element |
| `createImageBitmap(videoElement)` then transfer | works | expected to work | expected to work |

How the data was produced: the byte counts follow from the sizes, four bytes a texel, and from the preset table of [the quality presets](../../docs/concepts/quality-presets.md). The `VideoFrame` finding is the recorded result of test T-30. The two `createImageBitmap` cells are owed: `bun run test:real-browsers --only video-texture-webgl2,video-texture-webgpu Safari Firefox` runs the page on both. The measured cost of a frame's decode, its transfer and its upload is owed too.

## Decision

The page reads each frame with `createImageBitmap(video, { resizeWidth, resizeHeight, imageOrientation: 'flipY' })`, which every supported browser offers from a video element, and transfers the image to the sketch, which transfers it to the thread that draws. The sketch asks for the frames when a texture follows the video and stops them when it goes, so a video that nothing shows costs nothing. A video presents no frame while it is paused, so a paused video costs nothing either. A frame that comes while the one before it still uploads is dropped, so a frame larger than the budget shows fewer frames a second rather than an upload that restarts.

The `VideoFrame` route would carry a decoded frame without a copy, but Safari and Firefox cannot make one from a video element, so the engine would carry two routes for no gain on the browsers where the copy is cheap.

## Consequences

- `engine.registerVideo(video, { name, maxSize, frameRate })` joins the page API, and `textures.fromVideo(name, options)` the texture API, with `texture.destroy` stopping the frames.
- The page and the sketch trade two reserved messages, which never reach the sketch's or the page's own message handlers.
- The page allocates one `ImageBitmap` a frame, which the thread that draws closes once the frame is on the GPU. The engine allocates no texture and no engine memory a frame.
- The docs gain [Video textures](../../docs/guides/video-textures.md) and a section of [Textures](../../docs/api/textures.md); the three.js mapping's `VideoTexture` entry and the develop skill's recipe 14 name the new calls.
