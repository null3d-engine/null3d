Plans: checks 2026-09-27 to 2026-09-30 and 2026-10-03;
bench 2026-09-27 and 2026-09-28;
parity 2026-09-27 and 2026-09-29;
depth 2026-09-29 and 2026-09-30;
overload 2026-09-30;
checks 2026-10-05 on the gate commit 89a1d6295;
checks 2026-10-06 on main 55ab8d73;
the room image, environment generator and WebGPU engine pages 2026-10-05, on main 32f387b8d and fix/firefox-room-copy;
the window state pages and smoke 2026-10-06, on test/browser-window-park

Result: checks 2026-09-30: 293 of 293 passed.
The cube and 3D texture test alone, 2026-10-03: 3 of 3 passed.
The outline tests alone, 2026-10-03: 11 of 11 passed.
checks 2026-10-05 on the gate commit: 825 passed, 6 failed, the room environment on WebGL2 in each thread mode and one WebGPU page without GPU times (run 20261005-191616-checks).
checks 2026-10-06 on main 55ab8d73, with #350: the 6 failed pages, 6 of 6 (run 20261006-033432-checks).
Main, 2026-10-05: the WebGL2 room image 0 of 2 (run 20261005-224324-checks); the environment generator page on WebGL2 failed, its finished cube wrong (run 20261005-224921-checks).
The fix: 13 of 13, the 3 generator pages, the WebGL2 room image in 5 modes and the WebGPU engine page in 5 modes with GPU times for 22 of about 22 sampled frames (runs 20261005-224957-checks, and for the engine pages after a timer correction, 20261005-225125-checks).
The sprite and culled image pages with each indirect draw's own arguments, 2026-10-06: 7 of 7 passed.
The window state pages, 2026-10-06: on WebGL2 and WebGPU, a window in view, 85% covered, wholly covered, or parked past the main display's left edge drew 120 frames per second, the display's rate, and the page never reported itself hidden.
Smoke with the window parked (run 20261006-090345-smoke): 52 of 52 passed, and the app in front kept the focus
