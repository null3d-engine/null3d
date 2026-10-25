Plans: vegetation-scatter 2026-10-24. The branch is the milestone branch at `3f2ab72a1`.
BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Chrome
152.0.7977.54 on Android 15.

Result: 2 passed, 0 skipped, 0 failed; timing figures unreliable, because the display ran at 30 Hz.

The plan's two pages place Creek's valley with the vegetation add-on's ecological rules. Both
return the same 955 plants and the reference checksum, 916344353. The placement runs on the CPU
and starts no engine, so both pages run the same work.

The valley took 9.8 ms to place on the first page and 5.9 ms on the second, each the middle of
three runs. The ground maps took 51.3 ms and 50.9 ms. A placement time is the page's own reading,
so the display's 30 Hz cannot change it, but the cloud reported the phone hot and the figure is an
upper bound.

The device has WebGPU, so its second page really ran the WebGPU path.

results: /Users/ram/dev/null3d-timings/target/runs/20261024-203522-vegetation-scatter
session: https://automate.browserstack.com/builds/3fd8ae0f0b4e22d14f375789b36895239aa26b65/sessions/45ded05f687816a3e3b953454dcbdc6f1bfe06c5
