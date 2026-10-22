# D-220: One job builds the production pages of the browser tests

Status: decided. Date: 22 October 2026. Task: none.

Summary: Every browser job built the production pages of the browser tests before its first test, for 283 s on average. Only 2 of the 40 shards ran a test that reads them. One job, `browser-production`, now builds them once and runs the production build projects' tests. Every other browser job leaves them out. That saves about 4.7 minutes in each of 48 jobs of a full run. The weights of the 40 shards are tuned again for the tests that they hold.

## Question

In full CI run 39554447893 of 21 October 2026, most browser shards took 15 to 25 minutes. Their model said about 10. Where did the rest go, and did the work belong in every shard?

## Rule

[D-218](D-218-efficient-ci-jobs.md): a job does a piece of work only when no other job does the same work on the same inputs, and only the work that its own checks need.

## Data

| Measure | Result |
| --- | --- |
| The production build before the first test, in each of the 40 browser shards of run 39554447893 | 237 to 353 s, 283 s on average, 184 runner minutes in all |
| The same build in the other browser jobs of that run: the alone tests, the showcase HUD, the city and the skill sketches | 253 to 364 s each |
| Shards that ran a test of the production build projects | 2 of 40, for 366 s and 408 s of test time |
| The production build projects' tests | 120 tests and 12 that run alone, in 8 files; 774 s of test time in that run |
| One page's production build in `target/production-pages` | about 2.5 GB in 6,275 files, since each page bundles the whole shader set |
| The slowest shard with the old weights, modelled over today's test list without the production build | 60.5 minutes of tests |
| The slowest shard with the new weights | 10.4 minutes of tests |

How the data was produced: the logs of the run's browser jobs, from the line that starts the browser run to the line that starts the first test, and the times of the production build projects' tests in them. `bun run test:browser-weights --run 39554447893 --shards 40` modelled the shards.

## Decision

- `bun run build:test-pages` holds the build: each page, or the pages that it names, one at a time. The Playwright config runs it before the production server, as before, unless `NULL3D_PRODUCTION_PAGES` says otherwise.
- With `NULL3D_PRODUCTION_PAGES=skip`, a run starts no production server and has no production build project. The `browser`, `browser-alone`, `browser-city`, `showcase` and `skill-sketches` jobs set it.
- `browser-production` builds the pages once. Then it runs the production build project, and then that project's tests that run alone, one at a time. Both runs set `NULL3D_PRODUCTION_PAGES=prebuilt`, which serves the built pages and builds none. Playwright runs projects side by side, so the tests that run alone need a run of their own to have the machine to themselves.
- The job runs in two parts. Each part builds only the pages that its test files load, so no page builds twice. See the update below.
- The 40 shards' weights come from the times of run 39554447893 over the test list without the production build. The weights in the workflow had not been tuned since the list grew. With them, the model put the slowest shard at 60.5 minutes.

## Update, 23 October 2026: two parts, and no CDN build

In full run 39813231961, the one job took 18 minutes: 314 s for the build, 611 s for the tests and 133 s for the tests that run alone.

| Measure | Result |
| --- | --- |
| The CDN build, the first step of the build | 52 s, read by no production build test |
| Each page's build, one after another | 29 to 43 s |
| One page's build on a Mac | 44 s, one core, 9.2 GB at its peak (12 GB resident) |
| Shader files that each page's build writes | 6,010, of which 5,574 are the same file under the same name in every page |
| Test time of the files that load the engine test page: engine, glTF, KTX2, CDN and the policy test | 833 s, and 121 s that run alone |
| Test time of the errors, sketch shaders and stats files | 242 s |

- Only `cdn-script-tag.spec.ts` reads the CDN build, and it runs in the `browser` shards, which make the build themselves. The chain no longer makes it.
- Two page builds at once would not fit the 16 GB of a CI machine, so the builds stay one at a time, and the job splits by test file instead. A test file needs every page whose HTML it names. The files that load the engine test page hold most of the test time, so they make one part, with the engine, KTX2, texture cache and glTF pages. The errors, sketch shaders and stats files make the other, with their three pages. The parts are about 13 and 5 minutes long.
- Three parts would take each part under 9 minutes. But the glTF and KTX2 tests load the engine test page too, so two parts would each build it. The two-part split does each piece of work once ([D-218](D-218-efficient-ci-jobs.md)).
- The production server waits for its port, not the engine test page, since one part builds no engine test page. A part's run names its test files before `--project`, which takes every name that follows it, and its run of the tests that run alone passes with no tests, since the second part has none.

## Consequences

- `tests/playwright.config.ts` reads the switch, whose name `tests/lib/server.ts` holds. `tools/shard-weights.ts` lists the tests with the switch at `skip`, as the shards run them.
- `tools/lib/ci-workflow.test.ts` checks that only `browser-production` builds the pages, and that every other job that runs the browser tests sets the switch to `skip`. It also checks that each production build test file runs in one part, and that the part builds every page whose HTML the file names. `tests/lib/server.ts` holds the lists of pages and test files.
- [Image tests](../image-tests.md#ci) describes the job, and AGENTS.md names the command.
