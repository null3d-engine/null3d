# Maintainer guides

These guides hold the detail behind [AGENTS.md](../AGENTS.md), so that file can stay short. They are for people and agents who work on the engine, not for developers who use it. Public docs never link here.

| Guide | Contents |
| --- | --- |
| [Benchmarks](benchmarks.md) | How to run the benchmarks and read their numbers, the benchmark job in CI and its expected-change trailer, the sweeps for open defaults, allocation sampling and profiling |
| [Benchmark results](benchmark-results.md) | Every benchmark scene's figures against three.js, one row per device, browser, GPU path, date and commit, and the archive of each run's records that feeds them |
| [Code review, October 2026](code-review-2026-10.md) | The library code review of 4 October 2026: the high findings by fix group, the order of the fixes, the code issues that the technique review found, and the challenges to recorded decisions |
| [Decision records](decisions/README.md) | Design choices settled by measurement: the question, the rule, the data and the outcome of each. `bun run decisions` prints the list of records from the records themselves |
| [Device sessions](devices.md) | The device runner and its plans, which device runs each check, and how to set up and run the Android phone, the iPad, the Mac's browser apps and BrowserStack's device cloud |
| [Driver bug reports](driver-bugs.md) | Faults of GPU drivers and browsers that the engine works around, each with its device, its smallest known case and its workaround, ready to report upstream |
| [Image tests](image-tests.md) | The image test manifest, its references in each environment and on each device, the review step, and CI's shards |
| [Implementation notes](implementation-notes.md) | Habits that keep the hot paths fast, and the browser faults that shaped the code |
| [Pull requests and parallel work](pull-requests.md) | Merging main into a branch and its generated files, commit messages and pushes, merging a pull request, what CI runs where, CI's jobs, and several copies of the repository on one machine |
| [Releases](releases.md) | How a release is made, versions, and the one-time setup |
| [Sample content](sample-content.md) | The large models, textures and environments that tests and benchmarks load: where they live, how to fetch and use them, how to add one, and why they are not in this repository |
| [Technique review, October 2026](technique-review-2026-10.md) | The comparison of null3D's techniques with eight engines' source: the ranked changes, the porting verdicts, the `three-compat` add-on, the prototypes and their pass rules, the gaps, the web search results with their sources, and where earlier reports were wrong |
| [Tested devices](tested-devices.md) | Every device and browser that null3D has run on, with the facts and the known issues, a folder of runs for each, and how to add a run |

A guide or a decision record follows AGENTS.md's writing rules, as a contributor file.
