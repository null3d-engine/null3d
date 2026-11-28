# D-405: A missing shader word skips a mesh pipeline, and fails a full-screen pass

Status: decided and built. A production build whose shader list lacks a word skips the draws of a mesh pipeline and publishes the word. A full-screen pass stops with the word in its error. `bunx @null3d/cli shaders verify` fails on the word before the build ships. Task: none.

Summary: A narrowed build that met a word its list lacked stopped the render worker, and the page lost its scene. The engine now reports the word once and skips the affected mesh draws, so the rest of the scene draws. The new `shaders verify` command drives a production build on both GPU paths and fails on a missing word.

## Question

A narrowed shader set copies only the builds of the words that a recording reached. A word that the recording missed is absent from the build. The engine then built a pipeline whose variant the set lacks. The pipeline build threw during the frame, the render worker stopped, and the page fell back to its static form.

The word reached the scene about forty seconds after load, when an idle camera brought a mesh into a level of detail's fading band. A short recording never reached that state. The error named the word, but only at run time, and the whole scene was already gone.

How does a missed word fail safely, and how does a project find it before the build ships?

## Rule

- A mesh pipeline whose variant the loaded shader set lacks draws nothing. Its objects are absent, and every other object in the frame draws. This holds on WebGPU and on WebGL2.
- The engine publishes each missing word on `window.__null3dMissingWords`, once per word. It logs one warning too. A production build keeps the report, because a narrowed production build is where it matters.
- A full-screen pass has no draw to skip. Its missing word stays fatal, and the error names the word and the list. The page's own recovery, such as a replacement element, stays the page's.
- `bunx @null3d/cli shaders verify` builds the project for production with its list and serves the build. It drives each page on both GPU paths, and fails when a page reports a missing word.
- A recording streams the drawing thread's growing word set to the page, and the recorder stops a live page after a quiet window. A fixed time is a sample; a set that stopped growing is evidence.

## Data

The incident's word was `0x00080124`, in the level of detail and car-paint family. The site's list grew from 93 words to 99 after a longer recording, which reached the states that the first run missed.

A mesh pipeline's missing variant is the common case. A material, a mesh or a level of detail in a state that the recording did not reach asks for it. A full-screen pass's missing variant is rare. The engine's own passes load with the start, so their words are in the list.

## Look

A complete list draws the same pixels as before. A list with a missing mesh word draws every other object, and the affected objects are absent. A missing full-screen word draws no frame after the pass fails, as before.

## Decision

The engine catches a missing variant at the pipeline build, where it knows the template. A template that draws meshes becomes a pipeline whose draws skip, as a pipeline that the driver refused twice does. The backend reports the word through a page sink. A template of a full-screen pass has no draw to skip, so its error goes on to the frame's fault.

The page publishes the words on a global array, so a tool reads the same report in a release build without a console. A development build also logs the word once, with the command that records it.

`shaders verify` reuses the command-line tool's production build server, its browser and its page-driving options. It reads the published words after the page's states are driven. It also reads a page error that names a word, which covers a full-screen pass.

A recorder's live page now streams its words as the drawing thread finds them. It stops after `--settle-ms` with no new word, within `--max-ms`. `--steps` gives a project's own Playwright steps a first-class path. An action-gated state then needs no `--extra` word by hand. `--scroll-dwell` rests each scroll step for a state that arrives with time.

Options rejected:

- **Keep the fatal error, and recover the page.** A page-level recovery would need a way to replace the missing objects, which the engine cannot do without the shader. It would also hide the fault from a check.
- **Fail the whole build when a word is absent.** The build cannot know which states a page reaches. The check drives the states instead.
- **Pick the words by hand with `--extra`.** That path stays for a state that no page reaches, but a project's own steps reach an action-gated state without it.

## Consequences

- `packages/engine/src/gpu/variants.ts` carries the missing-variant error, the page sink and the live recording sink.
- The WebGPU backend skips a mesh pipeline's draws; the WebGL2 backend uses a refused program for the same rule.
- `packages/engine/src/page/engine.ts` publishes `window.__null3dMissingWords` and warns once per word.
- `packages/cli/src/shader-verify.js` holds the check, and `packages/cli/src/shader-record.js` holds the stable-set wait and the steps module.
- `guides/assets-pipeline`, `cli/null3d` and `guides/deterministic-simulation` describe the check and the new recording options.
