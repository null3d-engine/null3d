Plans: checks 2026-09-27 to 2026-10-03;
bench 2026-09-27, 2026-09-28 and 2026-10-02;
parity 2026-09-27 and 2026-09-29;
depth 2026-09-29 and 2026-09-30;
overload 2026-09-30;
startup 2026-10-03;
governor 2026-10-05 (with `?render=main`, with `?threads=off`, and in the default mode);
checks 2026-10-05 on the gate commit 89a1d6295;
the room image, environment generator and WebGPU engine pages 2026-10-06, on fix/firefox-room-copy, with the room's timing in turns;
the window state pages, bench (S4 at Low, 3 runs of each GPU path) and smoke 2026-10-06, on test/browser-window-park;
checks 2026-10-06 on main 8699fab4e;
the removed-frame memory probe 2026-10-07, opened plainly and through WebDriver (safaridriver)

Result: checks 2026-09-30: 293 of 293 passed.
startup 2026-10-03: 55 of 55, twice.
The cube and 3D texture test alone, 2026-10-03: 3 of 3 passed.
The outline tests alone, 2026-10-03: 11 of 11 passed.
governor 2026-10-05 with `?render=main`: before the fix, the hold failed on WebGL2; after it, 4 of 4, three times.
With `?threads=off`: 4 of 4, twice.
In the default mode: 4 of 4.
checks 2026-10-05 on the gate commit: 825 passed, 6 failed (run 20261005-223110-checks).
The 2 pages of the 100,000-sprite scene hit WebKit bug 321876, two indirect draws from one buffer in one render pass hanging the GPU, and macOS reset the GPU.
The 4 engine start pages failed because the screen locked, and passed 4 of 4 with the display awake (run 20261005-234423-checks).
checks 2026-10-06 on main 8699fab4e, with the sprite fix #353: the 2 sprite pages, 2 of 2, no GPU reset (run 20261006-044752-checks).
fix/firefox-room-copy, 2026-10-06: the first run passed 8 of 13 (run 20261006-004641-checks), after about 30 page loads in one Safari session.
The room maker page on WebGL2 could not create a program, and 3 WebGPU engine pages stalled or did not stop.
In a fresh session the 3 engine pages passed alone (run 20261006-010027-checks), and then all 13 passed (run 20261006-010234-checks), with GPU times for 12 or 13 of about 12 sampled frames.
The GPU wait in the room maker costs nothing that shows: the first lit frame came in 317 ms with it and 429 ms without, inside a spread of 269 to 574 ms.
The failed pages of the M1 gate's run, 2026-10-06: the 4 engine restart pages passed with the display kept awake; the 2 `sprites-100k` pages hung the GPU on WebGPU and in compatibility mode until the fix for indirect draws from one buffer, then passed, with 8 other sprite and culled pages.
fix/indirect-copies-gpu, 2026-10-06, with the copies limited to Apple's WebKit ([D-87](../../decisions/D-87-webkit-indirect-arguments.md)): 14 of 14 sprite, S1, cell and instancing pages on WebGPU and in compatibility mode, the 2 `sprites-100k` pages included, with no GPU reset (run 20261006-083923-checks).
The window state pages, 2026-10-06: on WebGL2 and WebGPU, a window in view, 85% covered or wholly covered by other windows drew 57.5 to 60 frames per second, Safari's limit, and the page never reported itself hidden.
A hidden Safari drew 0, and a window on the second display 30.
A window parked past the main display's left edge drew 60.
Bench, S4 at Low (runs 20261006-085320-bench in front, 20261006-085507-bench parked, 20261006-085700-bench in the background unparked): the same 60 frames per second and GPU time (3.13 to 3.19 ms on WebGPU) each way, but the CPU time per frame in front was 0.16 ms on WebGPU and 0.78 ms on WebGL2, against 0.22 to 0.24 and 1.12 in the background, parked or not.
Smoke with the window parked (run 20261006-085847-smoke): 52 of 52 passed, and the app in front kept the focus.
Removed-frame memory probe 2026-10-07: 8 of 8 (plain runs 20261007-041400-checks and 20261007-042223-checks; WebDriver runs 20261007-043544-checks and 20261007-043815-checks).
Each page removes 2 frames that share a 256 MiB memory, then watches the room for about 19 s: 16 s of pauses and the counts between them.
Plain Safari: a page with no engine held 1 place, with its page kept, for at least the 19 s that the probe watched.
On WebGL2, an engine stopped 2 s before its frame went held 2 places.
All else came back in 2 to 5 s.
Through WebDriver, the plain page held 1 to 2 places on both paths.
The probe's own count can hold every memory it counts, so its room figures are a guide only ([D-92](../../decisions/D-92-safari-removed-frames.md#addendum-2026-10-07)).
