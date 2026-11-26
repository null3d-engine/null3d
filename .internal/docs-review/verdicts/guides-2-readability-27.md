# guides-2-readability-27

## Finding as given

- page: guides/video-textures
- anchor: ## Browser limits, lines 93-103
- category: structure
- severity: low
- claim: The 9 bullets mix browser limits (formats, autoplay, CORS) with engine behavior (frame reports at 101, playback ownership at 103). Line 100 repeats the code comment at lines 38-40, and line 98 repeats line 89.
- evidence: line 100 'Keep the element in the page's layout, out of sight. An element that `display: none` hides may give no frame in some browsers.'
- proposedEdit: Split into 'Browser limits' (formats, autoplay and sound, cross-origin, display: none, phone frame rate) and 'How the engine follows the video' (frame reports, createImageBitmap, playback stays with the element). Cut the repeats at lines 98 and 100, or shorten each to one sentence.

Verdict: partly

## Evidence

- Page lines 95-103 hold 9 bullets under "Browser limits". Lines 95, 96, 97, 100 and 102 are browser limits. Line 103 (the engine never plays, pauses or seeks the element) is engine design, not a browser limit. This part of the claim holds. The source agrees: packages/engine/src/page/videos.ts never calls play, pause or seek.
- Lines 99 and 101 are mixed. Each states a browser fact (VideoFrame support, browsers that report no frames for a hidden element) and then the engine's way around it (createImageBitmap at videos.ts:271; requestVideoFrameCallback at videos.ts:210-213 with a time check fallback that stops while paused at videos.ts:233). So they belong near browser limits, but they are implementer detail.
- Line 100 repeats the code comment at lines 38-40. This holds. But the bullet is the scannable place for the limit. A reader who skims the list should not have to find the rule in a code comment. Cutting line 100 is the wrong fix; shortening the code comment is the better one.
- Line 98 does NOT repeat line 89. Line 89 is about a sketch that follows a name the page never registered. Line 98 is about a browser that refuses to play (autoplay policy). They share only the result (material color, no error). Line 98 has its own information and must stay. Its real overlap is with line 96 (autoplay and sound), and the two can merge into one bullet.
- A whole new section for three bullets adds a heading for little gain. The page already has an engine-behavior section ("What a video costs while it does nothing", lines 86-91), and line 91 already speaks about ImageBitmap.
- stats.json lists no long paragraphs for this page, so length is not the issue; only grouping is.

## Corrected claim

The list mixes one pure engine fact (line 103) and two engine workarounds (lines 99 and 101) with browser limits. Line 100 repeats the code comment at lines 38-40. Line 98 does not repeat line 89; it overlaps line 96 about autoplay.

## Corrected edit

- Move line 103 out of "Browser limits" to the paragraph at line 68 ("The texture follows the video ..."), as one sentence: the engine never plays, pauses or seeks the element.
- Merge lines 96 and 98 into one autoplay bullet: a video with sound plays only after the user acts, unless muted; a refused video sends no frames, and the material draws with its color alone, with no error.
- Keep line 100 in the list. Shorten the code comment at lines 38-40 to one line, for example "Park the element past the page's edge; see Browser limits."
- Keep the browser fact of lines 99 and 101 as short bullets ("Safari and Firefox cannot make a VideoFrame from a video element"; "some browsers report no frames for a video that the page never shows"). Put the engine's workarounds in one collapsible block at the end of the section, closed by default:

<details>
<summary>Technical details: how the page reads each frame</summary>

The page makes each frame with `createImageBitmap`, which every supported browser has, so it does not need `VideoFrame`. It waits for the browser's report of each presented frame. When a browser gives no reports, the page checks the video's time on each display frame while the video plays, and stops that check while it is paused.

</details>

The main text makes sense with the block closed.
