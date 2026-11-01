# iPhone 16 in Safari

- Device: iPhone 16 (BrowserStack's device list), 393 x 852 at 3x, 4 cores
- OS:
- Browser: Safari 18.5
- GPU: Apple GPU
- GPU paths: WebGL2
- Where: BrowserStack Automate

## Known issues

Without the memory fix [#352](https://github.com/null3d-engine/null3d/pull/352), the engine pages end in E1109 after about a dozen pages ([run](20261004-earlier-runs.md)).
With it, the checks plan passes 14 of 14 pages with no E1109 (run 20261006-025258-checks).
