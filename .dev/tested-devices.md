# Tested devices

This record lists every device and browser that null3D has run on, with the plans that ran and their results. [Device sessions](devices.md) says how each device runs. It feeds the compatibility matrix in the README and in the user docs, as the owner asked on 4 October 2026.

## The record

Each device and browser has a folder in [`tested-devices/`](tested-devices/). The folder's README gives the facts and the known issues. Each other file in the folder records one run: the plans that ran, with their dates and commits, and the result. The [tables of tested devices](tested-device-tables.md) come from the READMEs, and `bun run docs` writes them. Git does not keep them. Each row links to its folder of runs. `bun run devices:record` prints the whole record as one table, with every run's plans and results.

A new run is a new file, so two pull requests that record runs do not edit the same lines. They clash only when both add a device, a fact or a known issue at one place. [D-97](decisions/D-97-tested-devices-per-file.md) gives the reasons.

The dates are the dates in the run names, which are in UTC. An empty cell means that nobody recorded the fact. "TestingBot's device list" or "BrowserStack's device list" marks a fact that the browser does not report, read from the cloud's own list of devices.

The Where fact names the place of each run: the owner's phone, tablet or Mac, TestingBot's device cloud, BrowserStack Live, or BrowserStack Automate. On BrowserStack Live, a person picks the device and the browser in each session. On BrowserStack Automate, which the team uses from 3 October 2026, the device runner opens and drives each session, with nobody at it ([Device sessions](devices.md#browserstack-automate)).

## How to add a run

1. Run a plan on the device with the device runner, as [Device sessions](devices.md) says.
2. At the end of a fixed plan, the runner prints an entry for each browser. It gives the run's file and the folder where the file goes. The file's name is the run's name, such as `20261007-054211-effects.md`. Its `Plans:` paragraph gives the plan and its date, and its `Result:` paragraph gives the counts. Add the commit to the plans, and what the run found to the result.
3. Never edit another run's file. A run that repeats a plan gets a new file too.
4. When no folder holds the device and browser, the runner prints a new folder's README as well. It gives a title, the facts, and "None recorded." under "Known issues". The runner knows less than a person, so first check that no folder holds the device under another name. A new browser on a known device gets a folder of its own. Then run `bun run docs`, which adds the folder's row to the [tables](tested-device-tables.md).
5. When a fact changes, such as the browser's version, edit its line in the README and run `bun run docs`. The runner prints an OS, a browser or GPU paths that the README lacks.
6. Add a known issue as a new paragraph under "Known issues" in the README, with a link to its pull request or decision record. Then run `bun run docs`.
7. Write links in these files relative to the file, such as `../../decisions/D-12-memory-budgets.md`. The tables move them to the page's folder.
8. The runner page saves what it found in `device.json`, in each runner's folder of the run: `target/runs/<run>/<runner>/device.json`. It holds the user agent and, where the browser has them, the client hints. It also holds the detected browser, the GPU, the screen, the pixel ratio, the cores and the page's address. `jq '{browser, gpu, userAgent, userAgentData}' target/runs/<run>/<runner>/device.json` prints the main facts.
9. The GPU facts are `gpu.webgpu`, the WebGPU adapter's details, `gpu.compatibility`, which says whether compatibility mode gave an adapter, and `gpu.webgl2.renderer`. Runs before October 2026 have no `gpu` and no `browser` in `device.json`. For those, read the checks plan's `capabilities.json`, under `report.webgpu.adapterInfo` and `report.webgl2.renderer`.
10. Leave a fact empty rather than guess. User agents freeze the OS version. Safari 26 reports iOS 18.7 on iOS 26, and Safari on an iPad reports a Mac. Chrome reports Android 10 on every Android. Only client hints give the real version. Brave and Firefox hide the GPU.

`bun run docs:check` and the commit hook refuse a file that breaks these rules. A folder's name is lowercase words joined by hyphens. A run file's name starts with the run's date as eight digits. Each folder has a README with all six facts and a "Known issues" section, and at least one run. Each run file has a `Plans:` paragraph, then the `Result:`, which may take several paragraphs to the end of the file.

A branch from before the split edited the old single table. [Pull requests and parallel work](pull-requests.md#a-branch-that-edited-the-old-table-of-tested-devices) says how to move its edits into run files.
