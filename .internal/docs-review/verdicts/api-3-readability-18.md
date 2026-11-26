# Verdict: api-3-readability-18

## The finding as given

```json
{
 "page": "api/splats",
 "anchor": "lines 80, 102, 110, 121, 145, 148",
 "category": "technical-details-block",
 "severity": "medium",
 "claim": "Line 80 (covariance, card axes, standard deviations) and line 102 (prefix coverage and growth) explain the method, not the API. Line 110 (165 words, 10 sentences) mixes chunk selection with where the work runs. Line 121 gives 'instead of' timings against an unnamed setup. Line 148 mixes ready, streams and settle(). Line 145 (lighting) is in the budget section.",
 "evidence": "stats.json longParagraphs for api/splats; line 123 'the reader arrived at 4.4 seconds instead of 7.9.'",
 "proposedEdit": "Line 80: keep 'Each splat draws as a camera-facing card that fades as a Gaussian, so overlapping splats read as one surface.', and put the rest in <details><summary>Technical details: how a card covers its splat</summary>. Lines 102 and 110: a three-step list (each chunk keeps an eighth; the budget gives nearer chunks finer levels; a small budget thins the whole cloud), with the rest and line 121 in <summary>Technical details: how the add-on chooses splats</summary>, naming what the timings compare. Line 148: a table Promise | Resolves when. Move line 145 to What it draws.",
 "generatedSource": "",
 "id": "api-3-readability-18",
 "slice": "api-3",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The four long paragraphs are facts from stats.json (stats lines 73, 95, 103, 141 are page lines 80, 102, 110, 148; stats count from after the front matter). The page is hand-written, so the source to edit is docs/api/splats.md.
- Lines 80 and 102 are correct, dense method detail (covariance, standard deviations, prefix coverage and growth). A details block suits them. This part holds.
- Line 110: the three steps match the code. packages/splats/src/select-reference.ts:83-93 gives each chunk, nearest first, its coarsest prefix while the budget lasts. Lines 94-106 then refine the nearest chunks up to the level their distance asks for. The "thins the whole cloud" step follows from the first pass (comment at 84-86). This part holds, but the first step needs "nearest first, while the budget lasts". Without it, the list says every chunk always keeps an eighth, which is wrong when the budget is small.
- Line 80's kept sentence repeats the intro. docs/api/splats.md:32-34 already says "draws each one as a camera-facing card that covers the splat's projected ellipse and fades as a Gaussian, so overlapping splats read as one surface". Keeping that sentence as the open text of What it draws repeats it almost word for word.
- Line 121: the claim that the setup is unnamed is wrong. Line 123 names it: "In the splat demo, on a simulated phone connection". What the line does not name is the baseline: what the 7.9 s and 8.3 s figures measure (the reader and the first selection starting after the download). The reader can only guess this from the sentence before.
- Line 145: moving it to "What it draws" would repeat text. Lines 87-90 already say that splats draw unlit, with no lights, shadows or reflections. The Costs and limits list says "A splat casts no shadow and receives none". The only new content in line 145 is "Choose the light of the scene to match the light of the capture."
- Line 148: a table fits. packages/splats/src/system.ts:136-148 and 485-534 show three cases: `ready` for a file (every chunk is cut), `ready` for a stream (the nearest chunks, about a megabyte, or the nearest chunk alone), and `settle()` (chosen splats packed, and for a stream, the chunks they need have arrived). The rule "call `update` once before you await it" applies to a stream only (the doc comment at system.ts:137-140; for a file, `ready` is the cut promise at line 534). The intro example awaits `ready` with no `update` first. If that rule goes into the table without a scope, it reads as a rule for files too.

## Corrected claim

Lines 80, 102, 110 and 148 are long paragraphs that mix method detail with API behavior, and the dense detail belongs in details blocks. Line 121 names its setup (the splat demo on a simulated phone connection) but not its baseline. Line 145 sits in the budget section, but it repeats lines 87-90 and a Costs and limits bullet. Only its last sentence is new.

## Corrected edit

- Line 80: do not reuse the intro's sentence. Keep a short open text that is new, for example: "The card covers the whole splat, even a flat splat seen edge on, and a pixel too faint to show is dropped before it blends." Put the covariance, card axes and standard deviations in `<details><summary>Technical details: how a card covers its splat</summary>`.
- Lines 102 and 110: a three-step list. (1) Each chunk, nearest first, keeps an eighth of itself while the budget lasts. (2) The rest of the budget gives the nearest chunks finer levels, up to what their distance asks for. (3) So a small budget thins the whole cloud instead of dropping its far parts. Put the prefix coverage, the growth, the cloud-radius distance, the Rust module on the job worker and the core's packing in `<details><summary>Technical details: how the add-on chooses splats</summary>`. Move line 121 into that block too, and name the baseline: "than when the reader and the selection started after the download".
- Line 148: a table, Promise | Resolves when, with three rows: `ready` (file), `ready` (stream), `settle()`. Below the table, keep in prose: "For a stream, call `update` once before you await `ready`." Also keep the sentence that a file draws while it is being cut and never holds up a frame.
- Line 145: do not move it. Delete its first two sentences, because lines 87-90 and the Costs and limits list already say this. Add "Choose the light of the scene to match the light of the capture." to the end of the paragraph at lines 87-90.
