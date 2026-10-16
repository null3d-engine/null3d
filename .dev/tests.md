# Test memory

The unit tests run in one process for the whole repository, so what each test holds adds to the run's peak. This guide covers that cost, the rules that keep a test small, and the ceiling the unit script sets. [AGENTS.md](../AGENTS.md) lists the commands, and [Image tests](image-tests.md) covers the browser tests.

## How the unit run works

- `bun run test` builds the shaders, then runs `bun test` over the tools, the packages, the benchmark scenes and pages, and `tests/lib`.
- Bun runs every file in one process. Memory taken by one file is still held while the next file runs, so the run's peak is the sum of what the files hold at once.
- The generated shader set is the largest thing a test can hold: 1,343 modules and 850 MB of JavaScript source on disk. Git does not keep it; the build writes it.
- A single file that imports the whole set makes the process large on its own. The same file that reads the set's text costs a fraction of that.

## What the run cost on 16 October 2026

| Work | Peak memory | Time |
| --- | --- | --- |
| The whole unit run | 12.5 GB | about 15 minutes |
| One file that imports all 1,343 generated modules | 3.6 GB | 19 seconds |
| One merge of every shader part into a single map | 4.3 GB | 8 seconds |
| The same program count, read from the modules' text | 69 MB | 1 second |

The last row is the shape to copy. A count, a size or a name is almost always readable from the file's text, and it costs about a hundredth of the memory.

That run was one of the causes of an incident the same day: several helper agents on one machine pushed it past 70 GB, and the owner stopped the session. A test that holds a generated set in memory is not only slow; it can take the machine down with it.

## Rules

1. Read a count, a size or a name from the generated file's text. Import generated modules only when a test needs their values, and then only the modules it needs.
2. Load one part at a time and drop it before the next. Never hold every part of a set at once, and never merge the parts into one map to learn something a count gives.
3. A check that must compare against the whole set runs in its own process, through its own script. The unit run is shared, so such a check makes every other test pay for it.
4. Measure a test that touches generated data. Run it alone under `/usr/bin/time -l` and read the `maximum resident set size` line. Put the figure in the branch notes when the test changes.
5. Keep fixtures small, and read them one file at a time. Tests that need the large sample content use the shared cache that [Sample content](sample-content.md) describes.
6. When a check grows past the ceiling, split it rather than raising the ceiling. The ceiling exists to make a fault visible as a failed test, not to end a run with a dead machine.

## The ceiling

- The unit script sets a hard memory ceiling for the run, through Bun's `BUN_JSC_forceRAMSize`. A test that passes the ceiling fails with Bun's out-of-memory message, which names the limit, instead of growing until the operating system or another agent suffers.
- The ceiling is the smallest figure the measured run fits under, with room for a busy machine. [Branches and parallel work](pull-requests.md) covers why the machine matters: several copies of the repository run at once during parallel work.
- Raise the ceiling only for a measured need, and say in the commit message what needed it. A test that needs more than the ceiling usually needs splitting.

## Finding a heavy test

- Run each group on its own and keep the peak figures: `bun test tools`, then `bun test packages`, then `bun test tests/lib`. The heaviest file shows itself.
- `/usr/bin/time -l bun test <file>` prints the peak memory of that one file in bytes.
- A file whose peak is far above its work is usually importing a generated set, merging parts, or holding a decoded asset. All three have a cheaper shape.
