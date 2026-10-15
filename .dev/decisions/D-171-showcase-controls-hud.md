# D-171: The showcase controls HUD

Status: decided. Date: 14 October 2026. Task: M2-EX8.

Summary: The owner set the showcase scenes' on-screen controls on 14 October 2026. Each scene shows a translucent chevron at the bottom of the panel; pressing it slides up a full glass panel of grouped mode and effect buttons. The panel is a bottom-anchored column that scrolls inside itself, so a phone never cuts it off. Every button carries a tooltip that describes its function alone, with no input device named. Buttons sit in a row on a wide screen and in a column on a narrow one. Time of day is a mode group with an Auto driver that eases through the times of day and loops. Keyboard shortcuts stay basic: the camera and the HUD alone.

## Question

What on-screen controls does a showcase scene show, so that a visitor can change the scene's look and mood without a keyboard, and without the help covering the scene?

## Rule

The controls must show the scene at its best with nothing pressed, must read on a phone in portrait and landscape, and must not assume an input device, since a mouse, a keyboard and a finger all reach the same page. A scene shows only the groups it can support, and only features that are on main.

## Decision

The owner decided the design on 14 October 2026, after reviewing a mockup.

1. **Collapsible.** At rest the scene shows one translucent chevron button at the bottom, with a bright border. Pressing it animates a full panel up over a short transform and opacity transition. The chevron is the only toggle; its arrow flips. There is no header and no collapse button inside the panel. `prefers-reduced-motion` shortens the animation.
2. **Glass.** The panel, the section cards and the buttons are translucent glass: a light top sheen over a low-opacity tint, `backdrop-filter: blur(...) saturate(...)` with the `-webkit-` prefix, a bright hairline border and a top highlight. An active button uses a glassy accent, not a flat fill.
3. **Bounded and scrollable.** The panel is a bottom-anchored column with a bounded height, `overflow-y: auto` and a scrollbar. It stops just above the chevron, so it scrolls inside itself. Room is left for the chevron and the safe-area inset.
4. **Tooltips on every button.** A tip shows on hover, keyboard focus and a press, and hides on a pointer leave, a blur, a tap elsewhere, a panel scroll or after about 2.8 seconds. It sits outside the scrolling panel, so it is never clipped, and flips below its button when there is no room above. Its text describes the function alone: no mouse, keyboard, finger, phone or desktop is named.
5. **Shortcuts stay basic.** The camera's `C` and the HUD's `H` show as small `kbd` badges. Effects and mode choices carry no shortcut and are pressed with the pointer or a finger.
6. **Responsive.** Buttons sit in a row on a wide screen and in a column of wrapped rows on a narrow one, following the real width.
7. **Time of day is a mode group with Auto.** `Auto` eases the hour through the day and loops, each time cross-fading into the next; the fixed presets name a time and hold there. Auto is one button of the group, alongside the presets.
8. **The effect set.** Each scene shows the groups it supports, from Camera; Time of day; Atmosphere (sky, fog, light shafts, weather particles); Lighting (shadows, contact shadows, ambient occlusion, environment light); Reflections (where the scene has the surface); Post (bloom, depth of field, exposure, grading, vignette, TAA, outlines); Materials (where the scene has them); and Quality (the presets and the stats overlay). Only a feature that is on main or landing now is shown; one that is not yet available joins when it lands (M2-EX43 tracks the scene upgrades).

## Data

The mockup that the owner approved is the target look and behaviour. It is a standalone page with the same shell: a chevron, a glass panel, six groups (Camera, Time of day, Atmosphere, Lighting, Post, Quality) and the tooltip rules above.

How the data was produced: the owner's review of the mockup on 14 October 2026, and the shell's rules above.

## Consequences

- The DOM stays on the page, as before: `examples/lib/hud.ts` owns the shell and its interactions, and `examples/lib/run.ts` owns the help element and the `hud` message. The sketch never touches the DOM.
- The message carries a control model: `examples/lib/controls.ts` holds the types (`HudModel`, `HudGroup`, `HudButton`) and the shared option lists, and each scene builds the groups it supports.
- The shell's CSS lives with the examples' styles. The shell makes its elements and listeners once, and a render only turns buttons on and off, so the frame path allocates nothing.
- The camera group comes from `examples/lib/cinematic.ts`; the scene's own groups come from the scene. The HUD replaces the earlier plain rows of help text.
- `.dev/examples.md` describes the HUD in its showcase section.

## Addendum: toasts, and the bloom blend (owner, 14 October 2026)

The owner added two things to the controls on 14 October 2026.

- **A toast names each change.** When a mode or an effect changes, the page shows a short translucent
  toast at the top centre of the view, such as `camera: manual`, `Bloom: on` or `time of day: night`.
  It fades in and out over about 2 s, one replaces the old, it never takes a click, and its text names
  no input device. It comes from the same control model the HUD draws, so every group has it.
  `prefers-reduced-motion` shows it with no slide.
- **A takeover halts the route at once.** Taking the camera mid-transition sets the manual camera to
  the pose the route holds that moment and stops the route's motion there, with no drift; the user
  then holds that pose until they move. (An earlier draft eased the route's last motion to a halt over
  about 0.22 s; the owner removed the transition the same day. The D-170 addendum records it.) The
  pose passes the clearance guard, so a takeover never lands inside geometry.
- **The bloom blend: a question for the owner.** The engine's `Bloom.blend` default is `Mix`, which
  moves each pixel toward the glow by the intensity. At a typical intensity that crushes every pixel
  that is not glowing, so bloom looks as if it darkens the scene: turning bloom on in the night town
  made the surrounding snow and trees go dark. The showcase scenes now set `blend: 'add'` explicitly,
  which adds the glow as three.js does, and the HUD's bloom toggle does the same. The engine default
  stays `Mix` for Bevy parity (D-21 owns bloom); whether it should change to `Add` is the owner's
  question.

## Addendum: tabs, the loading overlay and the effects that start off (owner, 14 October 2026)

The owner asked for three follow-ups the same day, after reviewing the night town.

- **The panel is tabbed.** One tab per group, and only the selected group's buttons show, so the panel
  is short on any screen, a phone included. The owner asked for this so a phone shows fewer rows and
  less height, and still scrolls; the earlier one-card-per-group grid stacked or wrapped and grew
  tall. The tab bar scrolls across, the selected group scrolls inside a bounded panel, and the
  selected tab is remembered while the panel is open, with Camera first. The tablist is
  `role="tablist"`, each tab is `role="tab"` with `aria-selected` and `aria-controls`, each group is a
  `role="tabpanel"`, and the arrow keys, Home and End move between tabs. The glass style, the `h` key,
  the chevron, the tooltips and the toasts are unchanged.
- **A loading overlay.** `examples/lib/run.ts` shows a glass overlay over the canvas before the engine
  starts. It names the engine's start stages (`core`, `sketch`, `first-frame`) through `onProgress`,
  and any progress a scene posts while it loads. `examples/lib/progress.ts` reports a scene's file
  count from `assets.onProgress`; a scene with nothing to load posts its build phases. The overlay
  fades out when the first frame draws, with a short fade that `prefers-reduced-motion` removes, and
  shows the error text instead when the start fails.
- **Bloom, automatic exposure and the vignette start off.** The owner wants the showcase scenes to
  open on the look they approved, so each of those three effects starts off, its HUD button starts
  unpressed, and turning it on shows `bloom: on` and the like. The initial `post` settings match the
  off state, so no `post.set` turns bloom on at setup.

## Addendum: the lens key goes, and the stage keeps the switches (15 October 2026)

A code review on 15 October 2026 found two faults in the controls, and both are fixed under the rules above.

- **The lens had a key.** Both scenes toggled the depth-of-field lens with `D`, which also pans the Manual camera, so one press in Manual moved the camera, changed the lens and posted a toast. Point 5 gives a shortcut only to the camera and the controls, so the lens key is gone, and the Post tab's Depth of field button is the one way to turn the lens on. `examples/lib/cinematic.ts` now owns one table of every showcase key, and a scene's own key that clashes with it throws.
- **Sky, Fog and Environment undid themselves.** The scenes turned each part off with one call to the scene, and the stage wrote it back on the next frame. The stage now holds the three switches and leaves out each part that is off. The HUD test reads the canvas to check that the part stays off, since the toast alone said "off" while the fog stayed.
- **The studio had no button.** `MOODS`, the stage and both scenes support the studio, and Creek's caustics and air tables hold a row for it, but `TIMES_OF_DAY` had no Studio entry, so only `?mood=Studio` reached it and no test covered it. Studio is now the last entry of the Time of day tab, with a tip that names it as a backdrop rather than an hour, and `tests/image/showcase-hud.spec.ts` picks it and checks its toast. The tab keeps Auto and the seven hours as rule 7 describes, since Auto never eases through the studio.
- **The HUD and the demo runner leaked listeners.** `createHud` bound a `keydown` on the document and a `pointerdown` on the stage, and `startDemo` bound a wheel and a click on the canvas, none of which a page could remove; a page that started a second demo in the same document got two `keydown` handlers, so H toggled the panel twice. `createHud` now returns `dispose()`, which drops those listeners and the nodes it added, and `startDemo` takes an optional `AbortSignal` that does the same for its own listeners, its loading overlay and the HUD. `keydown` also ignores a key with Ctrl, Cmd or Alt held and any editable target, so a shortcut never types into a field. The controls HUD is otherwise unchanged.
