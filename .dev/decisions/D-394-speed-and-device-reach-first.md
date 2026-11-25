# D-394: The README and the docs lead with speed and device reach

Status: decided and written. The README, the docs home page, three docs pages, the engine package's README and the package descriptions carry the wording.

Summary: The owner ruled that null3D's public text leads with two claims: it is faster than three.js, and it works on current computers, tablets and phones. The text states the speed claim as five of six benchmark scenes, because null3D loses S1-static.

## Question

What does the first screen of the README and of the docs say about null3D?

## Rule

The owner decides the engine's public description. The text must match the repository's description on GitHub: "High-performance browser 3D engine for Agents. Rust and WebAssembly on worker threads, Wide device compatibility. Faster than Three.js!" Each claim must also match the benchmark table and the record of tested devices.

## Data

| Claim | What supports it |
| --- | --- |
| Faster than three.js | The README's performance table: null3D takes less time in S2, S4, S5, S1 and the desert, and more in S1-static (0.20 ms against 0.07 ms). |
| Wide device compatibility | The README's table of browsers and GPU paths, and the [tested devices](../tested-devices.md): iPhone 13 to iPhone 18 Pro, Pixel 6 to Pixel 11, Galaxy S24 and S25, Galaxy M32, Redmi Note 13, iPads, Galaxy Tab tablets, Macs and Windows PCs. |

How the data was produced: the figures are those of the README's performance table, and the devices are the folders in `tested-devices/`. No new run was made.

## Look

The options look the same. The change is text only.

## Decision

The opening of the README and of the docs home page gives three points: faster than three.js, wide device compatibility, and made for coding agents. "Where it runs" moves up, to follow the performance section, and names the tested devices.

Options rejected:

- "Faster than three.js" with no limit. null3D loses S1-static, so the text says five of six scenes and points to the table.
- "Tested on every device". Some runs in the record have failed pages, and many devices have no run. The text says that one sketch runs on current computers, tablets and phones, and names the devices that the test pages run on.
- The older opening, "for games and apps with many moving objects". It describes one kind of scene and leaves out the device reach.

## Consequences

A change to the benchmark table also checks the count of scenes won in the README, the docs home page, the performance guide and the engine package's README. A new kind of tested device may join the list in the README's "Where it runs".
