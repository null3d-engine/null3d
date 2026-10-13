Plans: environment-load 2026-10-11 on main f854dd72d: the built-in room, a 2K .hdr file and a 1K .exr file, asked for during play (M2-E9, M2-E4). It ran on WebGPU and WebGL2. The iPad was on its charger, with Limit Frame Rate on.

Result: 6 of 6, and no frame that used an environment lacked its light.
The room lit its first frame in 147 ms on WebGPU and 128 ms on WebGL2. That is 118 and 93 ms after it resolved, under prototype L1's 200 ms. On 7 October it took 318 and 203 ms after it resolved. The HDR files lit their first frame 100 to 113 ms after they resolved ([D-19](../../decisions/D-19-environment-maps.md)).
