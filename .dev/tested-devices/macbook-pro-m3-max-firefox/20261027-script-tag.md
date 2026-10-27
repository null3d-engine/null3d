Plans: a hand run of T-32, the script-tag build, in Firefox 158.0.1 on the server Mac on 2026-10-27. The tree was the milestone branch at `dc1e9d557`. The run served `target/cdn` from one origin and the test pages from another, with no bundler and no Playwright. It opened each case with `open -a Firefox` so the window was in front. The first three cases used `tests/pages/cdn-try.html`. They ran single-threaded with no isolation headers, and single-threaded through an import map. The third ran threaded with the isolation headers, where every worker starts from a `blob:` address. The fourth case used `tests/pages/cdn-addon.html` with the terrain add-on, threaded on core WebGPU. A hand-run page on the page's origin embedded each test page. It copied the page's own frame read-back into the window title, which the run read.

Result: 4 passed, 0 failed. The page reported no error in any case.

Single-threaded with no isolation headers: build `single`, threaded false, mapped false, frame 2560 x 1412. The center pixel was (221, 87, 0, 255), the orange box over the dark background.

Single-threaded through an import map: mapped true, with the same frame and the same center pixel.

Threaded with the isolation headers: build `threaded`, threaded true, with the same frame and the same center pixel. The threaded WebAssembly file loaded, so every worker started from its `blob:` address.

The terrain add-on, threaded on core WebGPU: tier `webgpu`, frame 2560 x 1412. The ground covered 0.479 of the frame, with mean color (47.5, 77.3, 33.8), where green is above blue and red. The add-on's compiled shader module came from the CDN.
