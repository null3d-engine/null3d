Plans: smoke 2026-10-04;
checks 2026-10-04, in thirds;
the two shader library pages 2026-10-05, from the M2-L9 branch;
the shader library and debug image pages, and the shaders page alone, 2026-10-05, from the M2-L9 branch's later commit

Result: 50 passed, 0 skipped, 1 failed checks 2026-10-04, every page but the shaders page: 789 passed, 0 skipped, 7 failed (runs 20261004-210247-checks with its rerun 20261004-214933-checks, 20261004-220701-checks, 20261004-232603-checks): 6 debug images differ in 0.56% of pixels against 0.5%, and the WebGL2 shader library page failed.
shader library 2026-10-05: WebGPU passed, WebGL2 failed again (run 20261005-003025-checks) shader library and debug images: 8 of 8 (run 20261005-030630-checks), the WebGL2 library page noting the device fault.
shaders page alone: passed in about 3.5 minutes, 1,113 WebGL2 programs in 197 s (run 20261005-030829-checks)
