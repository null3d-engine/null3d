Plans: vegetation-scatter 2026-10-24. The branch is the milestone branch at `3f2ab72a1`.
BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Chrome
152.0.7977.54 on Android 16.

Result: 2 passed, 0 skipped, 0 failed; timing figures unreliable, because the display ran at 30 Hz.

The plan's two pages place Creek's valley with the vegetation add-on's ecological rules. Both
return the same 955 plants and the reference checksum, 916344353. The placement runs on the CPU
and starts no engine, so both pages run the same work.

The valley took 9.0 ms to place on the first page and 11.7 ms on the second, each the middle of
three runs. The ground maps took 85.9 ms and 60.0 ms. A placement time is the page's own reading,
so the display's 30 Hz cannot change it, but the cloud reported the phone hot and the figure is an
upper bound.

The device has no WebGPU adapter, so the second page's `gpu=webgpu` switch names no engine that
this device started.

results: /Users/ram/dev/null3d-timings/target/runs/20261024-202948-vegetation-scatter
session: https://automate.browserstack.com/builds/3c879da0aa71746300152535a0d9fbcf28031899/sessions/4f96175f129e925fdc90ff14e824141ef804318f
