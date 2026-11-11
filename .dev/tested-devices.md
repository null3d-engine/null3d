# Tested devices

This record lists every device and browser that null3D has run on, with the plans that ran and their results. [Device sessions](devices.md) says how each device runs. It feeds the compatibility matrix in the README and in the user docs, as the owner asked.

## The record

Each device and browser has a folder in [`tested-devices/`](tested-devices/). The folder's README gives the facts and the known issues. Each other file in the folder records one run: the plans that ran, with their dates and commits, and the result. The [tables of tested devices](tested-device-tables.md) come from the READMEs, and `bun run docs` writes them. Git does not keep them. Each row links to its folder of runs. `bun run devices:record` prints the whole record as one table, with every run's plans and results.

A new run is a new file, so two pull requests that record runs do not edit the same lines. They clash only when both add a device, a fact or a known issue at one place. [D-97](decisions/D-97-tested-devices-per-file.md) gives the reasons.

The dates are the dates in the run names, which are in UTC. An empty cell means that nobody recorded the fact. "TestingBot's device list" or "BrowserStack's device list" marks a fact that the browser does not report, read from the cloud's own list of devices.

The Where fact names the place of each run: the owner's phone, tablet or Mac, TestingBot's device cloud, BrowserStack Live, or BrowserStack Automate. On BrowserStack Live, a person picks the device and the browser in each session. On BrowserStack Automate, the device runner opens and drives each session, with nobody at it ([Device sessions](devices.md#browserstack-automate)).

## How to add a run

1. Run a plan on the device with the device runner, as [Device sessions](devices.md) says.
2. At the end of a fixed plan, the runner prints an entry for each browser. It gives the run's file and the folder where the file goes. The file's name is the run's name, such as `20261007-054211-effects.md`. Its `Plans:` paragraph gives the plan and its date, and its `Result:` paragraph gives the counts. Add the commit to the plans, and what the run found to the result.
3. Never edit another run's file. A run that repeats a plan gets a new file too.
4. When no folder holds the device and browser, the runner prints a new folder's README as well. It gives a title, the facts, and "None recorded." under "Known issues". The runner knows less than a person, so first check that no folder holds the device under another name. A new browser on a known device gets a folder of its own. Then run `bun run docs`, which adds the folder's row to the [tables](tested-device-tables.md).
5. When a fact changes, such as the browser's version, edit its line in the README and run `bun run docs`. The runner prints an OS, a browser or GPU paths that the README lacks.
6. Add a known issue as a new paragraph under "Known issues" in the README, with a link to its pull request or decision record. Then run `bun run docs`.
7. Write links in these files relative to the file, such as `../../decisions/D-12-memory-budgets.md`. The tables move them to the page's folder.
8. The runner page saves what it found in `device.json`, in each runner's folder of the run: `target/runs/<run>/<runner>/device.json`. It holds the user agent and, where the browser has them, the client hints. It also holds the detected browser, the GPU, the screen, the pixel ratio, the cores and the page's address. `jq '{browser, gpu, userAgent, userAgentData}' target/runs/<run>/<runner>/device.json` prints the main facts.
9. The GPU facts are `gpu.webgpu`, the WebGPU adapter's details, `gpu.compatibility`, which says whether compatibility mode gave an adapter, and `gpu.webgl2.renderer`. When `device.json` has no `gpu` and no `browser`, read the checks plan's `capabilities.json`, under `report.webgpu.adapterInfo` and `report.webgl2.renderer`.
10. Leave a fact empty rather than guess. User agents freeze the OS version. Safari 26 reports iOS 18.7 on iOS 26, and Safari on an iPad reports a Mac. Chrome reports Android 10 on every Android. Only client hints give the real version. Brave and Firefox hide the GPU.

`bun run docs:check` and the commit hook refuse a file that breaks these rules. A folder's name is lowercase words joined by hyphens. A run file's name starts with the run's date as eight digits. Each folder has a README with all six facts and a "Known issues" section, and at least one run. Each run file has a `Plans:` paragraph, then the `Result:`, which may take several paragraphs to the end of the file.

## iPad Pro 11-inch, iPadOS 26.7: the upscaler probe

- Brave on iOS is WebKit, so this run measures the same engine as Safari. Two-step upscaler probe, canvas 1920x1080, render scale 0.5, FXAA on, timer wall clock with `gl.finish`, seven samples of twenty rounds. Head 5949e07cf.
- Mip bias 0: the bilinear pass 2.184 ms, GSR 0.537 ms, so GSR is 1.647 ms faster. Image scores at the engine's setting favor GSR: SSIM 0.9552 against 0.9532, MAE 1.48 against 1.49.
- Mip bias -1: the bilinear pass 2.434 ms, GSR 0.732 ms, so GSR is 1.702 ms faster. GSR scores slightly lower there: SSIM 0.9586 against 0.9655, MAE 1.34 against 1.20.
- The rule that decides the upscaler asks for a cost inside 0.2 ms. GSR is faster by more than eight times that on this iPad, and better at the engine's mip bias, so the iPad keeps GSR 1.

## iPad Pro 13-inch, iPadOS 26, Safari, on BrowserStack: the M2 gate's timed rows

The M2 gate's timed rows ran again on a newer tip through BrowserStack's cloud iPad Pro 13, the
same device the gate commit was measured on. Each row draws the showcase scene for 300 seconds, rests
five minutes while the device cools, and reports the frames presented.

| Scene | Path | Newest tip | Gate commit |
| --- | --- | --- | --- |
| S4 | WebGPU | 60.0 | 59.6 |
| S4 | WebGL2 | 60.0 | 60.0 |
| S5 | WebGPU | 29.0 | 36.1 |
| S5 | WebGL2 | 49.2 (59.4 once the preset falls to Low) | 60.0 |
| S6 | WebGPU | 59.8 | 59.8 |
| S6 | WebGL2 | 59.8 | 59.9 |

The device holds its target on every scene but S5, and S5 draws fewer frames on both paths than on
the gate commit. The engine's own threads use 3.1 ms of a 33 ms frame there, so the loss is on the
graphics side.
The rows were read from `target/runs/20261023-002748-showcase/bsipadpro13-safari` in the gate checkout.

## Vegetation on the five cloud devices

Creek and the forest demo ran for M3-V1 ([D-241](decisions/D-241-vegetation-foundation.md)) on the
cloud iPhone, the iPad, an S24-class phone and a low-end Android tablet. The Galaxy S25 ran Creek
on core WebGPU, and the package's generator on its own, in a later run. The runs took one
BrowserStack Automate session at a time. Each page fixed its GPU path and its preset. It also set
the quality governor's target at 1 frame a second, so the render scale stayed at 1 and each
preset's own cost shows.

WebGL2 and compatibility mode cap the preset at Medium ([the chooser](../packages/engine/src/quality/chooser.ts)).
So High and Ultra ran on core WebGPU only. Creek at Low on WebGPU stalls an Apple device's page
after its first frame ([Driver bug reports](driver-bugs.md)), so Creek has no WebGPU row on the
Apple devices.

The tables give the frames per second and the frame interval. They give the busiest thread's CPU
time per frame, and the GPU time where the device has a timer. They also give the triangles drawn,
the draw calls, and the memory of the GPU textures, the GPU buffers and the engine's WebAssembly.

### iPhone 17, Safari 26.6, iOS 26

| Demo and preset | Path | FPS | Frame ms | CPU ms | GPU ms | Triangles | Draws | Textures MiB | Buffers MiB | wasm MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Creek Low | WebGL2 | 59.5 | 15.7 | 8.7 | n/a | 2,687,000 | 118 | 60.8 | 14.7 | 68.4 |
| Creek Medium | WebGL2 | 22.5 | 43.9 | 23.6 | n/a | 6,152,100 | 129 | 163.9 | 18.4 | 79.6 |
| Forest Low | WebGPU | 50.7 | 15.6 | 3.5 | 6.6 | 13,760,000 | 88 | 30.9 | 34.4 | 328.8 |
| Forest Low | Compatibility | 60.0 | 15.6 | 3.5 | 6.4 | 12,040,000 | 88 | 30.9 | 34.4 | 328.8 |
| Forest Low | WebGL2 | 59.7 | 15.5 | 2.8 | n/a | 3,483,900 | 44 | 60.5 | 11.0 | 69.5 |
| Forest Medium | WebGPU | 15.7 | 62.1 | 14.3 | 53.7 | 110,690,000 | 116 | 87.8 | 57.0 | 462.3 |
| Forest Medium | Compatibility | 31.1 | 30.1 | 6.2 | 25.9 | 33,850,000 | 116 | 58.3 | 57.0 | 462.4 |
| Forest Medium | WebGL2 | 18.2 | 60.6 | 5.8 | n/a | 23,140,000 | 53 | 151.6 | 12.0 | 75.1 |
| Forest High | WebGPU | 15.9 | 62.5 | 14.2 | 54.5 | 61,640,000 | 144 | 93.1 | 57.0 | 667.9 |
| Forest Ultra | WebGPU | 9.8 | 99.0 | 11.2 | 87.5 | 29,030,000 | 170 | 250.4 | 63.7 | 864.0 |

The run: [20261024-105923-vegetation](tested-devices/iphone-17-safari/20261024-105923-vegetation.md).
Ten pages passed, and none was skipped.

### iPad Pro 13 2025, Safari 26.6.1, iPadOS 26

| Demo and preset | Path | FPS | Frame ms | CPU ms | GPU ms | Triangles | Draws | Textures MiB | Buffers MiB | wasm MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Creek Low | WebGL2 | 32.0 | 30.8 | 28.3 | n/a | 2,748,900 | 139 | 120.6 | 14.7 | 71.3 |
| Creek Medium | WebGL2 | 10.8 | 90.8 | 85.2 | n/a | 6,364,500 | 153 | 537.5 | 18.4 | 79.6 |
| Forest Low | WebGPU | 60.0 | 15.6 | 1.9 | 6.9 | 7,160,900 | 88 | 57.4 | 34.4 | 328.8 |
| Forest Low | Compatibility | 59.6 | 15.6 | 1.9 | 6.9 | 6,962,000 | 88 | 57.4 | 34.4 | 328.8 |
| Forest Low | WebGL2 | 60.1 | 15.5 | 1.5 | n/a | 4,839,200 | 35 | 95.8 | 11.0 | 69.5 |
| Forest Medium | WebGPU | 17.8 | 54.8 | 3.4 | 45.4 | 51,510,000 | 118 | 246.8 | 56.7 | 462.1 |
| Forest Medium | Compatibility | 28.5 | 33.8 | 3.5 | 23.9 | 101,890,000 | 118 | 107.4 | 56.7 | 462.3 |
| Forest Medium | WebGL2 | 19.6 | 46.6 | 1.1 | n/a | 34,880,000 | 43 | 424.3 | 12.0 | 75.1 |
| Forest High | WebGPU | 14.8 | 67.1 | 3.5 | 58.3 | 297,100,000 | 146 | 271.7 | 56.7 | 667.7 |
| Forest Ultra | WebGPU | 13.9 | 71.1 | 3.6 | 63.2 | 107,530,000 | 158 | 355.8 | 63.6 | 864.0 |

The run: [20261024-105210-vegetation](tested-devices/ipad-pro-13-safari/20261024-105210-vegetation.md).
Ten pages passed, and none was skipped.

The forest's GPU time at High and Ultra goes into the last render pass, which draws the far cards.
Its triangle count is higher at High than at Ultra, because each preset picks its own levels.

#### GPU time per pass

Only the WebGPU paths time their passes. Each row gives the whole frame's GPU time and the median of
each render pass that the engine times. A pass after the last one it times is counted in that last
pass's figure. The copies before the first pass take under 0.2 ms in every row.

iPhone 17, WebGPU:

| Row | Whole | R1 | R2 | R3 | R4 | R5 | R6 | R7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Forest Low | 6.6 | 0.7 | 5.2 | 3.4 | 2.9 | 2.8 | 2.3 | 2.4 |
| Forest Medium | 53.7 | 0.3 | 12.9 | 50.8 | 3.8 | 3.8 | 3.5 | 3.8 |
| Forest High | 54.5 | 0.3 | 8.7 | 13.3 | 6.4 | 6.6 | 6.9 | 43.5 |
| Forest Ultra | 87.5 | 0.5 | 1.6 | 19.7 | 24.2 | 8.6 | 9.3 | 62.5 |
| Forest Low, compatibility | 6.4 | 0.7 | 5.3 | 3.3 | 2.9 | 2.9 | 2.8 | 3.2 |
| Forest Medium, compatibility | 25.9 | 0.3 | 12.8 | 23.2 | 0.9 | 0.8 | 0.8 | 1.4 |

iPad Pro 13, WebGPU:

| Row | Whole | R1 | R2 | R3 | R4 | R5 | R6 | R7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Forest Low | 6.9 | 0.4 | 5.7 | 4.5 | 4.4 | 4.4 | 4.4 | 4.9 |
| Forest Medium | 45.4 | 0.1 | 9.1 | 43.1 | 6.4 | 6.4 | 6.2 | 6.8 |
| Forest High | 58.3 | 0.1 | 2.7 | 11.9 | 6.2 | 6.5 | 7.1 | 49.0 |
| Forest Ultra | 63.2 | 0.3 | 1.1 | 11.7 | 13.9 | 6.7 | 7.2 | 49.2 |
| Forest Low, compatibility | 6.9 | 0.4 | 5.8 | 4.5 | 4.4 | 4.4 | 4.4 | 5.0 |
| Forest Medium, compatibility | 23.9 | 0.1 | 9.1 | 21.4 | 2.1 | 2.0 | 1.9 | 3.0 |

The passes of one frame add up to more than the whole. The engine times one frame in eleven, and a
pass that follows the last timed one is counted there. Read the columns side by side within a row,
not as parts of a sum.

### Galaxy S24 (SM-S921B), Chrome 152, Android 16

| Demo and preset | Path | FPS | Frame ms | CPU ms | GPU ms | Triangles | Draws | Textures MiB | Buffers MiB | wasm MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Creek Low | WebGL2 | 28.9 | 33.3 | 18.4 | n/a | 2,660,400 | 136 | 55.9 | 14.7 | 69.2 |
| Creek Medium | WebGL2 | 20.6 | 33.3 | 33.2 | n/a | 6,268,600 | 129 | 147.6 | 18.4 | 78.0 |
| Forest Low | WebGL2 | 29.6 | 33.3 | 15.7 | n/a | 3,382,200 | 49 | 58.7 | 11.0 | 69.5 |
| Forest Medium | WebGL2 | 22.7 | 33.3 | 13.4 | n/a | 21,860,000 | 53 | 137.7 | 12.0 | 75.1 |

The run: [20261024-110636-vegetation](tested-devices/galaxy-s24-sm-s921b-chrome/20261024-110636-vegetation.md).
Four pages passed, and none was skipped. The display ran at 30 Hz, so every frame interval is
33.3 ms and the CPU time says more. The run marks its timing figures unreliable for that reason.

### Galaxy Tab A9 Plus (SM-X216B), Chrome 152, Android 14

| Demo and preset | Path | FPS | Frame ms | CPU ms | GPU ms | Triangles | Draws | Textures MiB | Buffers MiB | wasm MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Creek Low | WebGL2 | 0.8 | 1,268.5 | 121.4 | n/a | 3,494,300 | 122 | 94.1 | 14.7 | 62.2 |
| Forest Low | WebGL2 | 2.6 | 385.2 | 5.5 | n/a | 4,681,100 | 34 | 80.9 | 11.0 | 67.4 |
| Forest Medium | WebGL2 | 0.5 | 1,820.8 | 105.5 | n/a | 38,690,000 | 47 | 210.2 | 11.8 | 86.3 |

The run: [20261024-111020-vegetation](tested-devices/galaxy-tab-a9-plus-sm-x216b-chrome/20261024-111020-vegetation.md).
**One row is void.** Creek at Low in compatibility mode lost the GPU on its first frame with E1302,
`vkQueueSubmit failed with VK_ERROR_DEVICE_LOST`. The page forced a mode that the device does not
offer, and no adapter was left to start another.

Three pages passed, three were skipped, and one failed. At that run the device offered no
compatibility adapter, so the plan skipped its compatibility pages, and it skipped them only after
that first one had run. It has no High or Ultra row at any path, because those presets draw on core
WebGPU only, and at that run the tablet offered no WebGPU adapter. A later run reports a WebGPU
adapter and plays every path, so the fault no longer repeated
([run](tested-devices/galaxy-tab-a9-plus-sm-x216b-chrome/20261101-030741-wind-field-cost.md)).
The adapter is present and the top presets still draw no row: its vegetation run
reports a WebGPU adapter and fails Creek at High while building one custom material's pipeline with
E1404 and VK_ERROR_UNKNOWN, on the current build and on the commit before the reflection landing
([record](tested-devices/galaxy-tab-a9-plus-sm-x216b-chrome/20261111-081454-vegetation.md)). Its
grass pages draw all four presets on the same adapter. That failure is
[an Adreno 619 driver fault](driver-bugs.md#adreno-619-a-pipeline-fails-to-build-with-vk-error-unknown-at-creeks-density),
so its High and Ultra rows wait on the fault rather than on a slower frame.
The page then reported 3 frames in 5.5 s, so the runner counted a pass with no triangles and no
texture bytes. Its figures are in no table here and must not be read. The device's own fault is in
[Driver bug reports](driver-bugs.md).

Creek at Medium failed: its first frame took 42 s, and then the measure drew no frame in 5.5 s. The
tablet is the slowest measured device. It draws Creek at Low under one frame a second, and the
forest at Medium under one frame a second.

### Galaxy S25, Chrome 152, Android 15: Creek on WebGPU

Creek has no WebGPU row on the devices above. Its Low page stalls an Apple device after its first
frame ([Driver bug reports](driver-bugs.md)). The Galaxy S24 offers no WebGPU adapter. The cloud
Galaxy S25 draws Creek on core WebGPU at every preset. The owner ruled that this phone stands in for
the S24 class, and its Adreno 830 is a faster GPU of another make than the S24's Xclipse 940.

| Preset | Path | FPS | Frame ms | CPU ms | GPU ms | Triangles | Draws | Textures MiB | Buffers MiB | wasm MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | WebGPU | 29.1 | 33.3 | 2.88 | 26.28 | 1,524,500 | 182 | 49.6 | 28.9 | 94.4 |
| Medium | WebGPU | 5.15 | 166.6 | 3.38 | 149.88 | 4,387,400 | 174 | 105.7 | 46.2 | 116.0 |
| High | WebGPU | 4.20 | 208.3 | 4.66 | 213.61 | 6,798,700 | 288 | 131.3 | 40.0 | 136.1 |
| Ultra | WebGPU | 1.95 | 499.8 | 4.47 | 468.19 | 11,100,000 | 303 | 341.1 | 44.2 | 184.8 |

The display ran at 30 Hz. Every frame interval except Low is longer than that cap, so those frames
are the device's own. The GPU times come from the GPU's timer.

The GPU time of each render pass, as the engine names it and times it. A pass that the preset does
not run is empty. The engine times one frame in a step. A pass after the last timed one is counted
there, so read the columns side by side within a row.

| Pass | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| copies | 0.00 | 0.00 | 0.03 | 0.00 |
| shadow cascade 0 | 0.26 | 0.33 | 0.33 | 0.85 |
| shadow cascade 1 | 0.79 | 0.85 | 0.98 | 2.16 |
| opaque 1 | 5.57 | 44.07 | | |
| prepass 1 | | | 45.74 | 182.19 |
| view copy 1 | 0.00 | 0.03 | 0.03 | 0.13 |
| opaque | 20.38 | 141.16 | | |
| prepass | | | 1.64 | 3.15 |
| ambient occlusion 0 | | | 0.13 | 0.33 |
| ambient occlusion 1 | | | 164.72 | 279.38 |
| transmission copy | 0.13 | 0.26 | | |
| transparent | 0.82 | 1.18 | | |
| between passes | 0.20 | 0.20 | 0.00 | 0.00 |
| bloom 0 | 0.07 | 0.07 | | |
| bloom 1 | 0.66 | 0.39 | | |
| Whole frame | 26.28 | 149.88 | 213.61 | 468.19 |

Low and Medium draw with bloom, and the opaque pass carries almost all of the frame. High and Ultra
turn on ambient occlusion, which splits the depth prepass from the opaque pass. The CPU time stays
near 3 to 5 ms at every preset, so the cost is the GPU's.

The run: [20261029-200013-vegetation](tested-devices/galaxy-s25-sm-s931b-chrome/20261029-200013-vegetation.md).
Five pages passed, and none was skipped. The same plan ran on this phone on 27 October
([that run](tested-devices/galaxy-s25-sm-s931b-chrome/20261027-002402-vegetation.md)), and it holds
no per-pass figures.

### Creek through the vegetation add-on (M3-V11)

Creek grows its plants at first use. It has 12 species records with up to four variants each, and
it places 2,543 plants from seed 7, where the rows above loaded model files. The figures below
measure that scene.

The Mac's page drew at its display's full 1,512 by 982 points at the display's pixel ratio, where
the folder's earlier Creek record drew 1,920 by 1,080, so compare the counts rather than the
milliseconds across the two. The Mac's WebGL2 timer reports the whole frame, not one pass.

| Device and preset | Path | FPS | Frame ms | CPU ms | GPU ms | Triangles | Draws | Textures MiB | Buffers MiB | wasm MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mac, Low | WebGPU | 38.2 | 26.19 | 4.12 | 46.04 | 4,560,000 | 780 | 85.4 | 79.9 | 119.9 |
| Mac, Low | compatibility mode | 38.9 | 25.68 | 3.18 | 42.21 | 4,850,000 | 783 | 85.4 | 72.0 | 104.3 |
| Mac, Low | WebGL2 | 34.1 | 29.31 | 2.50 | 49.08 | 6,130,000 | 279 | 103.5 | 40.5 | 100.2 |
| Mac, Medium | WebGPU | 20.0 | 50.04 | 3.06 | 93.06 | 4,830,000 | 698 | 276.4 | 84.6 | 116.1 |
| Mac, Medium | compatibility mode | 28.2 | 35.50 | 2.97 | 67.01 | 4,870,000 | 698 | 160.5 | 84.6 | 116.1 |
| Mac, Medium | WebGL2 | 13.0 | 77.22 | 2.62 | 126.43 | 9,420,000 | 297 | 410.6 | 44.0 | 108.5 |
| Mac, High | WebGPU | 11.2 | 89.28 | 3.61 | 150.60 | 8,450,000 | 846 | 359.6 | 86.7 | 126.7 |
| Mac, Ultra | WebGPU | 13.4 | 74.53 | 2.01 | 140.25 | 9,950,000 | 855 | 516.6 | 90.9 | 143.8 |

The Mac's run: [20261102-131805-vegetation](tested-devices/macbook-pro-m3-max-chrome/20261102-131805-vegetation.md).
Thirteen pages passed, and none was skipped. WebGL2 and compatibility mode cap the preset at
Medium, so their High and Ultra pages drew Medium again and are left out.

The Galaxy S25 stands in for the S24 class. The table is the run below, on the scene before the
wildflower record and before the trunks' prepass option.

| Device and preset | Path | FPS | Frame ms | CPU ms | GPU ms | Triangles | Draws | Textures MiB | Buffers MiB | wasm MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Galaxy S25, Low | WebGPU | 30.0 | 33.33 | 6.31 | 24.61 | 2,280,000 | 752 | 47.5 | 79.9 | 117.8 |
| Galaxy S25, Medium | WebGPU | 6.0 | 166.62 | 5.53 | 164.43 | 2,440,000 | 669 | 114.2 | 92.5 | 135.6 |
| Galaxy S25, High | WebGPU | 4.4 | 224.98 | 5.91 | 237.63 | 3,700,000 | 812 | 135.9 | 94.6 | 147.9 |
| Galaxy S25, Ultra | WebGPU | 2.2 | 458.20 | 7.30 | 451.22 | 6,510,000 | 829 | 355.7 | 98.8 | 181.7 |

The S25's run: [20261102-132333-vegetation](tested-devices/galaxy-s25-sm-s931b-chrome/20261102-132333-vegetation.md).
Five pages passed, and none was skipped. Its High row reads 16.68 ms over the 208.3 ceiling. That
reading did not hold: the phone was hot, and its later High runs read lower.

Two later runs put the final scene at High, which carries the wildflower clumps. One had the trunks
in the depth prepass and one had them out. Both read a 208.29 ms median frame interval against the
208.3 ceiling, so the frame measure passes. Their GPU medians are 231.67 and 224.85 ms, and the
frame medians agree because the page paces its frames, not because the plants cost the same. The
runs' mean frame intervals were 239.2 and 226.6 ms, so they cannot order the code states against
each other. The exclusion's own saving is the Mac's measured 0.92 ms of GPU time.

| Galaxy S25, High | Median frame ms | GPU ms | Triangles | Draws | Run |
| --- | --- | --- | --- | --- | --- |
| Trunks out | 208.29 | 231.67 | 3,590,000 | 783 | 20261102-142543-vegetation |
| Trunks in | 208.29 | 224.85 | 3,750,000 | 860 | 20261102-142844-vegetation |

### Tree generation, all four devices

The page generated the stand-in parametric tree of `tests/pages/lib/tree-generator.ts` in a worker:
oak, beech, birch and pine at each preset's detail, six seeds each.

| Device | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| iPhone 17 | 22.7 ms | 14.3 ms | 17.8 ms | 14.8 ms |
| iPad Pro 13 | 16.8 ms | 14.6 ms | 19.5 ms | 14.3 ms |
| Galaxy S24 | 44.1 ms | 34.5 ms | 33.2 ms | 47.3 ms |
| Galaxy Tab A9 Plus | 56.4 ms | 49.4 ms | 59.3 ms | 93.5 ms |

Each figure is the page's own total for that preset: the 24 timed generations of four species and
six seeds. Each of those generations is timed inside the worker. The furthest triangle counts are
123,876 at Low and 474,096 at Ultra, and the arrays take 7.0 MB and 22.7 MB. The slowest single
variant on the tablet was an oak at Ultra: 5.42 ms for 27,090 triangles. The tablet's runs:
[20261024-111904-tree-generation](tested-devices/galaxy-tab-a9-plus-sm-x216b-chrome/20261024-111904-tree-generation.md).
The other three are in their folders: the iPhone and the iPad at 20261024-084032, and the S24 at
20261024-084231.

### Tree generation on the Galaxy S25

The `tree-generation` plan ran again on the cloud Galaxy S25, with the vegetation package's own
generator instead of the stand-in ([its run](tested-devices/galaxy-s25-sm-s931b-chrome/20261027-002251-tree-generation.md)).
The page generated every species at each preset's detail in a worker, six seeds each: thirteen
species, so 78 variants for a preset.

| Preset | Variants | Total (ms) | Per variant (ms) | Triangles | Bytes (MB) |
| --- | --- | --- | --- | --- | --- |
| Low | 78 | 163.0 | 2.09 | 337,008 | 16.7 |
| Medium | 78 | 137.9 | 1.77 | 337,008 | 16.7 |
| High | 78 | 156.9 | 2.01 | 409,182 | 20.0 |
| Ultra | 78 | 148.9 | 1.91 | 409,182 | 20.0 |

The phone stands in for the S24 class. D-241's generation budget then allowed a whole variant set to
build in 200 ms on the slowest measured device, and every preset sits inside it; the line is now
250 ms a variant on the reference Mac. The cost per variant is
about 1.7 times the iPad's, whose rows are below. Its byte column counts the arrays before the leaf
parts carried the morph data, so it is lower than the iPad's.

### Tree generation on the iPad Pro 13

The same plan ran on the cloud iPad Pro 13 in Safari 26.6.1
([its run](tested-devices/ipad-pro-13-safari/20261030-014425-tree-generation.md)). The page
generated every species at each preset's detail in a worker, six seeds each: 78 variants for a
preset.

| Preset | Variants | Total (ms) | Per variant (ms) | Triangles | Bytes (MB) |
| --- | --- | --- | --- | --- | --- |
| Low | 78 | 105.2 | 1.35 | 337,008 | 20.5 |
| Medium | 78 | 77.6 | 1.00 | 337,008 | 20.5 |
| High | 78 | 93.3 | 1.20 | 409,182 | 24.5 |
| Ultra | 78 | 80.6 | 1.03 | 409,182 | 24.5 |

D-241 then allowed the set 200 ms on the slowest measured device and 150 ms on the iPad. Every preset
sits inside both lines, and the slowest is Low at 105.2 ms, 70 per cent of the iPad's line. The line
is now 250 ms a variant on the reference Mac.

The arrays take 20.5 MB at Low and Medium and 24.5 MB at High and Ultra, which is inside the 25 and 30 MB
that D-241 sets. The leaf parts carry the next level's place for each vertex, which the material's morph
reads.

### Tree generation on this Mac with the catalogue species

The plan ran on this Mac's Chrome 156.0.8078.81 at `75b1e59f2`, after the batch's twelve catalogue
species landed ([its run](tested-devices/macbook-pro-m3-max-chrome/20261109-075455-tree-generation.md)).
The package ships twelve species, so a preset's set is 72 variants.

| Preset | Variants | Total (ms) | Per variant (ms) | Triangles | Bytes (MB) |
| --- | --- | --- | --- | --- | --- |
| Low | 72 | 12,440.8 | 172.79 | 15,274,350 | 382.2 |
| Medium | 72 | 12,261.9 | 170.30 | 15,863,454 | 393.5 |
| High | 72 | 12,472.2 | 173.22 | 16,299,114 | 402.3 |
| Ultra | 72 | 12,878.1 | 178.86 | 17,721,942 | 428.4 |

The catalogue species are far heavier than the thirteen procedural stand-ins the earlier figures
measured: 50,718 to 887,750 triangles a variant against about 4,300, and the set takes 12.3 to 12.9 s
against the old 200 ms whole-set line, about sixty times it. The owner restated the line at 250 ms a
variant on the reference Mac, and the set's 170 to 179 ms a variant meets it.

### Tree generation on the Galaxy S25 with the leaf morph data

The plan ran twice on the cloud Galaxy S25 with the current generator. The second run came after the
phone had time to cool, and it is the figure
([its run](tested-devices/galaxy-s25-sm-s931b-chrome/20261030-021612-tree-generation.md)). The page
generated 78 variants for each preset.

| Preset | Variants | Total (ms) | Per variant (ms) | Triangles | Bytes (MB) |
| --- | --- | --- | --- | --- | --- |
| Low | 78 | 198.6 | 2.55 | 337,008 | 20.5 |
| Medium | 78 | 164.9 | 2.11 | 337,008 | 20.5 |
| High | 78 | 161.9 | 2.08 | 409,182 | 24.5 |
| Ultra | 78 | 172.4 | 2.21 | 409,182 | 24.5 |

D-241 then allowed the set 200 ms on the slowest measured device. Low is inside it at 198.6 ms, by
0.7 per cent, and the other presets sit inside it. The line is now 250 ms a variant on the reference
Mac. Both runs drew on a 30 Hz display, and the runner
names the phone's heat or the display setting, so the figure carries that caveat.

The first run
([its run](tested-devices/galaxy-s25-sm-s931b-chrome/20261030-015719-tree-generation.md)) read
213.4 ms at Low while the cloud reported the phone hot. It is discarded as an upper bound, and the
two runs differ by 14.8 ms at Low.

The arrays take 20.5 MB at Low and Medium and 24.5 MB at High and Ultra, which is inside the 25 and 30 MB
that D-241 sets.

### The splats add-on at its full count, iPad Pro 13 and Galaxy S24

The splats streaming page drew a 400,000-splat cloud at the Low preset on the cloud iPad and the
cloud S24-class phone ([its plan](devices.md#the-splats-plan)). Each path drew exactly the budget
that it settled on, so the cloud stayed within it.

| Device and path | Budget | Drawn | Chunks | Presented fps | First frame |
| --- | --- | --- | --- | --- | --- |
| iPad Pro 13, WebGPU | 100,000 | 100,000 | 10 | 1.07 | 28.6 s |
| iPad Pro 13, WebGL2 | 50,000 | 50,000 | 10 | 3.29 | 28.0 s |
| Galaxy S24, WebGL2 | 37,500 | 37,500 | 10 | 12.4 | 27.5 s |

The iPad's display ran at 59 Hz. The S24's ran at 30 Hz, so the runner marks its timing figures
unreliable. The cloud in these runs was built in the page's code and handed to the add-on as a blob,
so the add-on downloaded no stream. The add-on's streaming reads an index and downloads
only the chunks that the view needs.

The runs:
[20261024-074806-splats](tested-devices/ipad-pro-13-safari/20261024-074806-splats.md) and
[20261024-074630-splats](tested-devices/galaxy-s24-sm-s921b-chrome/20261024-074630-splats.md).

### A real scan in the splats add-on, iPad Pro 13 and Galaxy S24

The splats plan also times the splats demo, which streams the Bolton Priory scan of 1.7 million
splats from the sample content. The engine chose Low on both devices, and the scan held the
display's rate on every path. The generated cloud, whose cards cover the screen many times over,
rose from 1.06 to 10.98 fps on the iPad's WebGPU path once the splats drew unlit with cards along
each ellipse's axes ([D-298](decisions/D-298-real-scan-splats.md)).

| Device and path | The scan, presented fps | 400,000-splat cloud, presented fps | Display |
| --- | --- | --- | --- |
| iPad Pro 13, WebGPU | 59.89 | 10.98 | 60 Hz |
| iPad Pro 13, WebGL2 | 60.05 | 19.58 | 60 Hz |
| Galaxy S24, WebGL2 | 29.18 | 29.12 | 30 Hz |

The S24's display ran at 30 Hz, so its rates show only that the pages keep up with it. The runs:
[20261102-144656-splats](tested-devices/ipad-pro-13-safari/20261102-144656-splats.md) and
[20261102-145233-splats](tested-devices/galaxy-s24-sm-s921b-chrome/20261102-145233-splats.md).

### The splats add-on streaming, iPad Pro 13 and Galaxy S24

Both cloud devices ran the streaming plan ([its plan](devices.md#the-splats-plan)).
The page read an index of 11 chunk files, 5,628,772 bytes for 400,000 splats, and the add-on
downloaded only the chunks that the view asked for.

| Device and path | Chunks loaded at the first view | Bytes at the first view | Bytes in the cloud | Presented fps |
| --- | --- | --- | --- | --- |
| Galaxy S24, WebGL2 | 3 of 11 | 1,890,725 | 5,628,772 | 12.74 |
| iPad Pro 13, WebGL2 | 5 of 11 | 3,451,272 | 5,628,772 | 3.28 |
| iPad Pro 13, WebGPU | 11 of 11 | 5,628,772 | 5,628,772 | 1.06 |

The S24's view needed 34% of the cloud, and the iPad's WebGL2 view 61%. The iPad's WebGPU path
loaded the whole cloud: the engine's startup preset check drew at Medium, whose budget wanted every
chunk at a coarse level, before it settled at Low. No chunk failed on any page, and each draw held
its settled budget: 37,500, 50,000 and 75,000 splats.

The 100,000-splat quarter clouds arrived whole on both devices, because each cut made one chunk of
almost all the splats.

The S24's display ran at 30 Hz and the Mac was loaded, so the timing figures are unreliable. The
rates match the full-count runs of the same cloud: 12.4, 3.29 and 1.07 frames a second.

The runs:
[20261024-171907-splats](tested-devices/ipad-pro-13-safari/20261024-171907-splats.md) and
[20261024-171610-splats](tested-devices/galaxy-s24-sm-s921b-chrome/20261024-171610-splats.md).

### The splats add-on at a quarter of its count, iPad Pro 13

The splats streaming page drew 100,000 splats at the same pixel count as its full run of 400,000
([its plan](devices.md#the-splats-plan)).

| Path | Drawn | Budget | FPS | First frame |
| --- | --- | --- | --- | --- |
| WebGPU | 100,000 | 250,000 | 2.84 | 26.5 s |
| WebGL2 | 25,003 | 37,500 | 6.88 | 26.3 s |

The full count drew 1.07 frames a second on WebGPU and 3.29 on WebGL2 in the same cloud. So a
quarter of the count gave between two and three times the rate, and not four times.
The cards' fill sets much of the cost, and the work of each splat sets the rest.

The WebGPU budget reads 250,000, which is Medium's count rather than Low's 100,000. The page reported
again only when the drawn count changed. This cloud's 100,000 splats fit under both Medium's 250,000
and Low's 100,000, so the move to Low changed no drawn count, sent no new report, and left
Medium's figure in place.

The run: [20261024-111706-splats](tested-devices/ipad-pro-13-safari/20261024-111706-splats.md).

### S3's 256 lights with depth-fitted clusters, iPad Pro 13 and Galaxy S25

The fit's before and after ran the device runner's bench plan: S3 on null3D's WebGPU page, three
runs of 10 s warm-up and 10 s measured each. The iPad chose Medium, where the fit runs, and the S25
chose Low, where it stays off.

| Device | Preset | Before, GPU ms | After, GPU ms | Light depth pass, ms |
| --- | --- | --- | --- | --- |
| iPad Pro 13 | Medium | 8.41 | 6.23 | 0.162 |
| Galaxy S25 | Low | 19.01 | 19.14 | none: the fit is off |

The iPad saves 2.18 ms, thirteen times the new pass. The phone's frame stays within the 0.1 ms that
two runs of the before build differ. The S25's display runs at 30 Hz, so the runner marks its
timing figures unreliable; its GPU times compare between its sessions. The S25 stands in for the
S24 class by the owner's ruling. [D-264](decisions/D-264-light-cluster-depth-fit.md) gives the
reason for each preset's choice.

The runs, before and after each device:
[20261030-150954-bench](tested-devices/ipad-pro-13-safari/20261030-150954-bench.md),
[20261030-162243-bench](tested-devices/ipad-pro-13-safari/20261030-162243-bench.md),
[20261030-150954-bench](tested-devices/galaxy-s25-sm-s931b-chrome/20261030-150954-bench.md) and
[20261030-162243-bench](tested-devices/galaxy-s25-sm-s931b-chrome/20261030-162243-bench.md).

## The sky's cloud tier on an iPad, an S24 and an S25

The clouds plan drew the sky alone, with the tier off and on in turn. Each page sets the step count
itself, so the tier draws on a path whose preset stops at Medium. The pages ran through BrowserStack
Automate, and each folder's README holds the device's facts.

| Device | Browser | Preset | Figure | Measured against | Run |
| --- | --- | --- | --- | --- | --- |
| iPad (10th generation), A14 | Safari 27.0 | Medium, a tablet's start preset; the page sets the steps | The tier's 32-step WebGPU frame stays within Safari's timer noise of the flat layer, 6.10 against 4.04 ms at render scale 1, and the 64-step page is within 0.14 ms of it | The flat layer in the same session, in turn | [20261031-233224-clouds](tested-devices/ipad-10th-generation-safari/20261031-233224-clouds.md) |
| iPad (10th generation), A14 | Safari 27.0 | Medium, a tablet's start preset; the page sets the steps | WebGL2's largest frame difference is 0.67 ms across the three step counts and both render scales | The flat layer in the same session, in turn | [20261031-233224-clouds](tested-devices/ipad-10th-generation-safari/20261031-233224-clouds.md) |
| Galaxy S24 (SM-S921B), Xclipse 940 | Chrome 152.0.7977.54, Android 16 | Low, a phone's start preset; the page sets the steps | The device has no WebGPU path, so its six WebGL2 pages ran. Every page held the 30 Hz display's 33.3 ms, including 64 steps, so 32 steps cost under half a frame | The High preset's 16.7 ms budget at 60 frames a second | [20261031-234019-clouds](tested-devices/galaxy-s24-sm-s921b-chrome/20261031-234019-clouds.md) |
| Galaxy S25 (SM-S931B), Adreno 830 | Chrome 152.0.7977.54, Android 15.0 | Low and Medium, the page sets the steps 32, 16 and 64 | The display is fixed at 30 Hz, so its frame intervals, 33.325 to 33.330 ms on both sides, are the floor and not the cost. The WebGPU timer reads 1.507 ms for the flat layer against 1.573 ms at 32 steps and scale 1, a cost of 0.066 ms at a timer step of 0.033 ms, far inside the 16.7 ms budget; WebGL2 gives this device no GPU timer | The High preset's 16.7 ms budget at 60 frames a second | [20261103-032559-clouds](tested-devices/galaxy-s25-sm-s931b-chrome/20261103-032559-clouds.md) |

The S24's display ran at 30 Hz, so its frame intervals are not a cost and its 64-step page is a
bound: a cost that grows with the steps puts 32 steps under half of the frame, which the page holds.
The iPad rows compare the tier with the flat layer within one session. The S25's display is fixed at
30 Hz on this service as well, so its frame intervals are its floor; its WebGPU timer is what
measures the tier there, at 0.066 ms for the High tier's 32 steps, and its WebGL2 path gives no
timer.
