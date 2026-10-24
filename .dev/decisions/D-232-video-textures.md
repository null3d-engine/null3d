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

## Addendum 24 October 2026: the check page, and what the browsers do

The check page plays a canvas's stream as a 640 x 360 video of two color bands, scaled to
`maxSize` 512, at the Low preset's 2 MiB upload budget. It measures two seconds while the video
plays and two while it is paused, captures the frame, and compares each band with a data texture
of the same color. A picture that is upside down swaps the bands, so the test tells it from one
that is right. The sketch reports the texture's size, which must be the 512 x 288 that `maxSize`
gives the video, so a browser that ignores the copy's resize options fails the run by name.

| Browser and path | A frame at p99 | The page's copy, median | After the pause, at p99 |
| --- | --- | --- | --- |
| Chrome on the Mac's GPU, WebGPU | 591,020 bytes | 0.13 ms | 1,196 bytes |
| Chrome on the Mac's GPU, WebGL2 | 590,832 bytes | 0.12 ms | 1,008 bytes |
| Chromium on SwiftShader, WebGPU | 591,020 bytes | 0.21 ms | 1,196 bytes |
| Chromium on SwiftShader, WebGL2 | 590,832 bytes | 0.21 ms | 1,008 bytes |
| Firefox 158 on the Mac, WebGPU | 591,020 bytes | 1.30 ms | 1,196 bytes |
| Firefox 158 on the Mac, WebGL2 | 590,832 bytes | 1.12 ms | 1,008 bytes |
| Safari 26.6.2 on the Mac, WebGPU | 591,280 bytes | 0.04 ms | 1,184 bytes |
| Safari 26.6.2 on the Mac, WebGL2 | 591,104 bytes | 0.04 ms | 1,008 bytes |

A frame of 512 x 288 RGBA8 is 589,824 bytes, which one frame of the Low preset uploads whole. The
figure after the pause is not the video: the engine writes about a kilobyte of its own every
frame, such as the values that a draw reads, and it is the same on both GPU paths and on both
renderers. A frame of the video in that window would be hundreds of times larger, and the check
still fails one. The colors of both bands sat within one step of the data textures' colors on
Safari and WebGL2, and within two steps on Firefox. The page's copy time is the time that
`createImageBitmap` takes to resolve; Safari's figure is far shorter than the others, so its copy
may finish later, when the image is read.

Three faults came out of the first runs, and each was fixed in the test rather than in the engine:

- Safari reported that the video never played, yet its frames arrived. WebKit can leave a video's
  play call's promise waiting with no answer (WebKit bug 200344), and it marks a video that plays
  from a canvas's stream as paused. The page now judges playback by the frames that it copies from
  the video, which no refused video gives, after a bounded wait on the play call.
- The runner page's frame had no autoplay permission, which a browser delegates to a frame only
  when it is asked. Safari then blocked the playback the page asked for. The frame now asks for
  `autoplay` (`tests/pages/runner.ts`).
- The window after the pause read the engine's own per-frame writes, about a kilobyte, as an
  upload of the video. The check now allows that figure and fails a window that carries a frame.

A browser that refuses to play the video sends no frames: the material draws with its color alone,
and the engine reports no error. A browser that refuses to copy a frame, as a cross-origin video
without CORS headers does, leaves the texture with the frame before it, and a development build
warns once. Both behave the same on the two GPU paths, because the copy happens on the page and
the upload takes the path that every image takes.

The guide keeps the video element in the page's layout, out of sight, rather than hiding it with
`display: none`: a browser that hides an element's box may also give no frame of it. The check
page parks its element past the page's edge for the same reason.

No demo shows video textures. The image manifest draws each demo from its sketch alone, in hold
mode, and a held frame has no page to send a video's frames, so a video demo would hold a picture
of the material's color and nothing else. The canvas-screen demo shows the sibling canvas path,
which a sketch drives itself.

