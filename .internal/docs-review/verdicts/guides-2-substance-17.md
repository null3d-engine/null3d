# guides-2-substance-17

## The finding as given

```json
{
 "page": "guides/phones",
 "anchor": "file lines 55, 57, 61, 73, 79, 81, 83, 91, 99, 103, 109; ## Heat line 91 (178 words)",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "11 paragraphs run over the limit. The Heat paragraph holds the heat advice, the governor's steps, onChange, the S24+ figure and three iPad figures. Line 81 holds KTX2 sizes, basisu -mipmap, UASTC against ETC1S and texture.format.",
 "evidence": "stats.json guides/phones longParagraphs (body lines 48-102; file lines are 7 higher).",
 "proposedEdit": "Heat: keep 'aim for about 70% of the frame budget and test runs of 10 minutes', the governor link and one figure. Move the iPad figures into <details><summary>Technical details: measured heat on a phone and a tablet</summary>. KTX2: keep 'load large textures from KTX2 files' and move formats and encoder flags into 'Technical details: KTX2 formats on phones'.",
 "generatedSource": "",
 "id": "guides-2-substance-17",
 "slice": "guides-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The claim holds. stats.json lists 11 long paragraphs for guides/phones. With the 7-line offset they are file lines 55, 57, 61, 73, 79, 81, 83, 91, 99, 103 and 109. The page is hand-written, so no generated source applies.
- docs/guides/phones.md:91 holds what the finding says. It has the heat advice, the governor's steps, onChange, the S24+ figure ("about 70% longer") and three iPad figures (17 ms against 12.6 ms, about 45 frames per second, 60 at Low after 5 minutes).
- docs/guides/phones.md:81 holds what the finding says. It has the 1.3 and 0.7 MiB sizes, `basisu -mipmap`, UASTC against ETC1S and `texture.format`.
- The edit leaves 9 of the 11 paragraphs with no fix: lines 55, 57, 61, 73, 79, 83, 99, 103 and 109. The finding lists them, but gives a fix only for Heat and KTX2.
- The linked pages already hold the detail that the edit moves:
  - The iPad heat figures are at docs/concepts/quality-presets.md:63, which phones.md:91 links to.
  - The S24+ figure is at docs/guides/performance.md:76, which is also linked.
  - The KTX2 formats are at docs/api/textures.md:87-91, the mip-level rule with `basisu -mipmap` at :100, and the sizes at :258. phones.md:81 links to textures.md#ktx2-files.
  - The CLI command writes every mip level by itself (docs/guides/assets-pipeline.md:134). So `basisu -mipmap` matters only to a reader who encodes files by hand.
  
  A block for this detail is allowed, but the detail is not lost without one.
- The edit says nothing about the governor's steps or `quality.onChange` in the Heat paragraph. `onChange` tells the sketch author how to lighten their own work. It must stay in the main text. Only the list of what the governor lowers, and in what order, is detail for a block. quality-presets.md#the-frame-budget-governor already holds that list.
- "Move formats" out of the KTX2 paragraph is too broad. The reason a phone page names KTX2 is that the texture stays compressed on the GPU: 1.3 MiB in place of 5.3 MiB. That sentence must stay in the main text, or "load large textures from KTX2 files" gives no reason.

## Corrected claim

11 paragraphs run over the limit (file lines 55, 57, 61, 73, 79, 81, 83, 91, 99, 103, 109). The worst are Heat (line 91, 178 words, 11 sentences) and KTX2 (line 81). Their extra figures repeat pages that they already link to. Most of the others are 64 to 85 words and pass only the sentence limit. Line 61 (Shadows, 101 words) and line 79 (texture memory, 104 words) need a break.

## Corrected edit

- Heat (line 91): split it into three paragraphs.
  1. The heat advice: aim for about 70% of the frame budget, test runs of 10 minutes, and the S24+ figure with its link.
  2. "When frames still take too long, the frame-budget governor lowers the quality step by step. The `quality.onChange` handlers run after each step, so the sketch can lighten its own work too", with the governor link.
  3. "Tablets heat up too. A warm iPad can drop from 60 to about 45 frames per second at Medium, and Low holds 60", with the quality-presets link.

  Put the governor's order of steps and the 17 ms against 12.6 ms GPU times in `<details><summary>Technical details: what the governor lowers, and measured heat on an iPad</summary>`.
- KTX2 (line 81): keep three sentences in the main text: "Load large textures from KTX2 files", the CLI command, and "a KTX2 texture stays compressed on the GPU, about 1.3 MiB in place of 5.3 MiB". Put the ETC2 figure without alpha, `basisu -mipmap` for files that you encode by hand, UASTC against ETC1S, and `texture.format` in `<details><summary>Technical details: KTX2 formats on phones</summary>`.
- Texture memory (line 79): break the paragraph before "A texture that the sketch makes from an image or from data keeps its levels".
- Shadows (line 61): break it before "So leave `cascades` and `mapSize` out". Move the sentence on 16-bit shadow depth to the end of a block, or cut it. The reader cannot act on it.
- Memory (line 73): break it before "So the quality preset's texture memory budget". Keep the iPad warning about GPU buffers in the main text, because it is a limit that the reader must stay under.
- Lines 55, 57, 83, 99, 103 and 109 are 64 to 85 words. Break each one at its topic change:
  - line 57: before "The savings of the pixel ratio cap"
  - line 83: before "When the browser refuses memory"
  - line 99: before "[Input]"
  - line 103: before "A first view with few pipelines"
  - line 109: before "A validation error"

  Line 55 can stay as it is.
