Plans: smoke 2026-10-04;
hold page and 10 smoke pages 2026-10-05 in Safari 18.6, from the Safari 18 minimum branch;
the whole plan in 6 parts 2026-10-05 on main 94cd0095a;
the frame restart checks 2026-10-05 and 2026-10-06, before and after the memory fix

Result: 22 passed, 29 skipped, 0 failed; skipped the pages for WebGPU and compatibility mode, which the device lacks 2026-10-05, Safari 18.6: started; 6 passed, 4 skipped (WebGPU), 0 failed (run 20261005-080322-smoke); checks 2026-10-06 on main 55ab8d73, with the memory fix #352.
Whole plan 2026-10-05: every part ended with E1109 after about 12 pages (runs 20261005-155638 to 20261005-163432-checks).
Restart checks in Safari 18.6 on main: 1 passed, 2 failed with E1109 (runs 20261005-231552-checks, 20261006-003601-checks).
With the first fix: 13 passed, 2 failed (run 20261005-232006-checks).
With the fuller fix: 14 passed, 1 failed, the restart page for removed frames (run 20261006-002925-checks).
The frame restart controls in Safari 18.5: 1 passed, 3 failed with E1109 (run 20261006-010201-checks).
