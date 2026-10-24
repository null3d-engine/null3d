# iPad Air 3 in Safari

- Device: the owner's own iPad, model iPad8,1
- OS: iPadOS 26
- Browser: Safari 26.6.2, reporting a Mac user agent
- Screen: 834 x 1194 at 2 device pixels per CSS pixel; 8 cores; display at 59 Hz
- GPU: Apple GPU; WebGPU adapter `apple`, compatibility mode present, WebGL2 renderer `Apple GPU`
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: on the local network, driven by the runner page over HTTPS on the Mac's own server

## Known issues

The iPad's automation agent refused to start for a day: it reinstalled cleanly but timed out
waiting for WebDriverAgent, through every replug and a reinstall with the Apple profile. It started
on 23 October after the owner deployed an unrelated app from Xcode to the device. The cloud iPad
Pro 13 stood in meanwhile.

The iPad's Safari reports the page hidden when another app takes the screen, and a page that loses
it stops its run with "the browser reports the page hidden". Nothing may touch the device while a
timed row runs, and no other browser may raise a dialog: a Brave crash prompt once took the screen
and failed a row.

This device is an Air-class machine with an A12 chip, so its figures sit well below the iPad Pro
13's on the heavy scenes. Compare it with itself, not with the Pro.
