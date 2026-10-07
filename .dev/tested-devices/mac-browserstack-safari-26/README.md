# Mac (BrowserStack) in Safari

- Device: Mac (BrowserStack), 1920 x 1080 at 1x, 8 cores
- OS: macOS Tahoe (BrowserStack's device list)
- Browser: Safari 26.4
- GPU: Apple GPU; WebGPU adapter: apple
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

`frame-restarts-drawing-on-the-main-thread` failed: engines in removed frames kept their memory until the page went away (room 36, then 30, then 0).
The cloud iPhone shows the same; BrowserStack's automation link is a suspect
