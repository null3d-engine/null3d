# Verdicts: shots and demo links for api/page

## Shots

### showroom-tablet: reject
The tablet in the showroom demo is part of the 3D scene. It is drawn on an offscreen canvas inside the sketch (examples/showroom/tablet.ts), and a tap on it is handled in the sketch. No choice travels between the page and the sketch. The showroom sketch only sends "loading" progress text to the page (examples/showroom/sketch.ts lines 46 and 104). So the caption is wrong, and a car picture does not explain messages.
The reference file does exist (tests/image/references/chrome-real-gpu/webgpu/demo-showroom.png), but it shows a dark studio with a small car and a far-off tablet at 320x180. Nothing in it shows a message.

Better replacement (scripted): the gizmos demo. Its page draws HTML buttons Translate, Rotate and Scale. A click sends a "mode" message to the sketch with postToSketch (examples/lib/run.ts, showChoices), and the sketch's page.onMessage handler changes the handle mode (examples/gizmos/sketch.ts line 121). This is the same pattern as the color picker example.
Steps: open the examples page with ?demo=gizmos; wait for the first frame; click the "Rotate" button in the "Mode" group; wait one second; capture the panel with the buttons and the canvas, so the pressed button and the rotate rings both show.
Note: the reference image demo-gizmos.png shows the canvas only, without the HTML buttons, so it cannot stand in for this shot.

### devtools-messages: reject
No demo and no engine code logs sketch messages to the console. The examples page handler (examples/lib/run.ts, handleMessage) feeds the loading card and page readers and logs nothing. The page's own example also logs nothing. A console picture would need code that the page does not show, and a list of log lines teaches less than the bullet list it would sit under.

## Demo links

### showroom/ for "Messages between page and sketch": reject
The code exists in examples/demos.ts, but the demo does not show the concept. Its tablet lives in the scene, and its only messages are one-way loading notes.
Replace with gizmos/ (no code field, so the folder name). Its page buttons send a message and the sketch handler acts on it. Also a good fit: replay/ under "What a message can carry". Its page sends a Float64Array each frame (examples/replay/page.ts line 139), and the sketch copies it in its handler (examples/replay/sketch.ts line 68).

### hold-mode/ for "Hold mode": reject (weak fit)
The folder exists (examples/hold-mode/sketch.ts; no code field, so "hold-mode/" is right). But the demo shows repeatable held frames. It sends and receives no messages. The section is about when messages can flow in hold mode, so the link does not show that. The section already links to the testing guide, which is where hold mode itself is taught. If a link is wanted, put it on the testing guide.

## Concepts said to have no demo

- The transfer list: confirmed. No demo passes a transfer list to page.post or postToSketch. The replay page copies its typed array with slice instead.
- Messages on the page's thread: confirmed. No demo sets the sketch-thread option, and nothing in the examples serves a page without cross-origin isolation on purpose.
