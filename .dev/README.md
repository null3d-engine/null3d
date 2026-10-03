# Maintainer guides

These guides hold the detail behind [AGENTS.md](../AGENTS.md), so that file can stay short. They are for people and agents who work on the engine, not for developers who use it. Public docs never link here.

| Guide | Contents |
| --- | --- |
| [Benchmarks](benchmarks.md) | How to run the benchmarks and read their numbers, the benchmark job in CI and its expected-change trailer, the sweeps for open defaults, allocation sampling and profiling |
| [Decision records](decisions/README.md) | Design choices settled by measurement: the question, the rule, the data and the outcome of each |
| [Device sessions](devices.md) | The device runner and its plans, and how to set up and run the Android phone, the iPad, the Mac's browser apps and TestingBot's device cloud |
| [Image tests](image-tests.md) | The image test manifest, its references in each environment and on each device, the review step, and CI's shards |
| [Implementation notes](implementation-notes.md) | Habits that keep the hot paths fast, and the browser faults that shaped the code |
| [Pull requests and parallel work](pull-requests.md) | Merging main into a branch and its generated files, commit messages and pushes, the merge queue, CI's jobs, and several copies of the repository on one machine |
| [Releases](releases.md) | How a release is made, versions, and the one-time setup |
| [Tested devices](tested-devices.md) | Every device and browser that null3D has run on, with the plans, the results and the known issues, and how to add a device |

A guide or a decision record follows AGENTS.md's writing rules, as a contributor file.
