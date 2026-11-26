# Verdicts: guides/audio (shots and demo links)

## Shots

### positional-sound: REJECT as proposed
- The file exists (tests/image/references/chrome-real-gpu/webgpu/demo-sound.png) and shows the default view: lightning over a dark moor in rain, a ring of standing stones and the brook as a dark band.
- The alt text is wrong. The reference image holds the canvas only, so it has no speaker button. The speaker button is drawn by the live examples page (examples/lib/sound-button.ts), which the image test does not use.
- "After the intro" is wrong. The sound demo has no intro; the first strike comes at about one second.
- The image is 320 x 180 pixels (the image test's default size). That is too small for a docs picture.
- A still frame cannot show sound. The page already has a diagram of the four kinds of sound, and the picture adds nothing a reader of a sound guide needs.
- If a picture is still wanted: capture the live examples page for the sound demo at docs size (for example 1280 x 720), after the first strike, while its label counts the seconds before the thunder arrives. That at least shows the "thunder plays from where it struck" idea for the Events section. Alt: "Lightning strikes a dark moor beside a ring of standing stones, with a label counting the seconds until its thunder arrives."

## Demo links

1. sound/ (Sources at places): KEEP. Exists in demos.ts. The sketch plays thunder as two one-shots at each strike's place with near and far, the brook as a group of points with near 3 and far 80, and rain as a bed. It is the clearest demo of one-shot events, so also link it under "Events". Note: the brook is a group of points, not one source moved to the nearest point as the guide says.
2. showcase/creek/ (Beds whose level the scene sets): KEEP. Exists. creek/sound.ts sets the wind bed's level and tone from the wind speed at the camera each frame, and the leaves bed from the distance to the nearest tree crown. This matches the section.
3. showcase/skyway/ (Groups of many sources): KEEP. Exists. skyway/sound.ts makes two groups of hover cars (roaming cars and lane cars) with four voices each.
4. showcase/island/ (Groups, "cars and bus"): KEEP with a fix. Exists. The cars are a group, but the bus is a single loop, not a group, so the concept should read "groups (the cars)". The island fits "Beds whose level the scene sets" better: its open-sea bed's level follows the distance out from the shore, and the sea near shore comes from points placed along the shoreline. That is the exact example the Beds section gives. Consider linking it there instead of as a second link under Groups.

## Concepts said to have no demo

- "how the sound reaches the speakers": CONFIRMED. Every sound demo uses the shared table and the audio-thread mixer, but none shows it. No demo or comparison deals with shared memory or cross-origin isolation.
