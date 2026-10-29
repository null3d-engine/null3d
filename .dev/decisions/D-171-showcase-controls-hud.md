# D-171: The showcase controls HUD

Status: decided by the owner. Built: the HUD with its tabs, tooltips, toasts, loading overlay and hour slider. Open for the owner's ruling: whether the engine's bloom blend default changes from `Mix` to `Add`. Task: M2-EX8.

Summary: Each showcase scene shows a translucent chevron that slides up a tabbed glass panel of mode and effect buttons, one tab per group, which scrolls inside itself so a phone never cuts it off. Every button has a tooltip that names its function alone, and every change shows a toast. Time of day is an hour slider with Auto and Studio buttons, and keyboard shortcuts stay basic: the camera and the HUD alone.

## Question

What on-screen controls does a showcase scene show, so that a visitor can change the scene's look and mood without a keyboard, and without the help covering the scene?

## Rule

The controls must show the scene at its best with nothing pressed, must read on a phone in portrait and landscape, and must not assume an input device, since a mouse, a keyboard and a finger all reach the same page. A scene shows only the groups it can support, and only features that are on main.

## Decision

The owner decided the design after reviewing a mockup.

1. **Collapsible.** At rest the scene shows one translucent chevron button at the bottom, with a bright border. Pressing it animates a full panel up over a short transform and opacity transition. The chevron is the only toggle; its arrow flips. There is no header and no collapse button inside the panel. `prefers-reduced-motion` shortens the animation.
2. **Glass.** The panel, the section cards and the buttons are translucent glass: a light top sheen over a low-opacity tint, `backdrop-filter: blur(...) saturate(...)` with the `-webkit-` prefix, a bright hairline border and a top highlight. An active button uses a glassy accent, not a flat fill.
3. **Tabbed, bounded and scrollable.** The panel has one tab per group, and only the selected group's buttons show, so the panel is short on any screen, a phone included. The tab bar scrolls across. The panel is a bottom-anchored column with a bounded height, `overflow-y: auto` and a scrollbar. It stops just above the chevron, so the selected group scrolls inside it. Room is left for the chevron and the safe-area inset. The selected tab is remembered while the panel is open, with Camera first. The tablist is `role="tablist"`, each tab is `role="tab"` with `aria-selected` and `aria-controls`, each group is a `role="tabpanel"`, and the arrow keys, Home and End move between tabs.
4. **Tooltips on every button.** A tip shows on hover, keyboard focus and a press, and hides on a pointer leave, a blur, a tap elsewhere, a panel scroll or after about 2.8 seconds. It sits outside the scrolling panel, so it is never clipped, and flips below its button when there is no room above. Its text describes the function alone: no mouse, keyboard, finger, phone or desktop is named.
5. **Shortcuts stay basic.** The camera's `C` and the HUD's `H` show as small `kbd` badges. Effects and mode choices carry no shortcut and are pressed with the pointer or a finger. `examples/lib/cinematic.ts` owns one table of every showcase key, and a scene's own key that clashes with it throws. `keydown` ignores a key with Ctrl, Cmd or Alt held and any editable target, so a shortcut never types into a field.
6. **Responsive.** Buttons sit in a row on a wide screen and in a column of wrapped rows on a narrow one, following the real width.
7. **Time of day is an hour slider with Auto.** The Time of day tab holds a slider from 0 to 24 hours with Dawn, Morning, Midday, Afternoon, Golden, Dusk and Night labeled along it, and the Auto and Studio buttons beside it. A new hour holds the stage at exactly that hour (`Stage.setHour`), and a scene takes the look of the fixed mood nearest to it, as Auto does. `Auto` eases the hour through the day and loops, each time cross-fading into the next. Studio's tip names it as a backdrop rather than an hour, and Auto never eases through it.
8. **The effect set.** Each scene shows the groups it supports, from Camera; Time of day; Atmosphere (sky, fog, light shafts, weather particles); Lighting (shadows, contact shadows, ambient occlusion, environment light); Reflections (where the scene has the surface); Post (bloom, depth of field, exposure, grading, vignette, TAA, outlines); Materials (where the scene has them); and Quality (the presets and the stats overlay). Only a feature that is on main is shown; another joins when it lands (M2-EX43 tracks the scene upgrades).

## Data

The mockup that the owner approved is the target look and behavior. It is a standalone page with the same shell: a chevron, a glass panel, six groups (Camera, Time of day, Atmosphere, Lighting, Post, Quality) and the tooltip rules above.

How the data was produced: the owner's review of the mockup, and the shell's rules above.

## The hour slider

While Auto runs, the controls model is posted to the page four times a second, so the slider's thumb follows the hour. A drag holds the page's thumb while the pointer is on it. Pressing Auto or a fixed hour stops the movement at once. The labels sit in two rows, so the seven names never overlap on a narrow screen, and the first and last anchor to the track's ends. `MOODS`, the stage and both scenes support the studio, and Creek's caustics and air tables hold a row for it. `tests/image/showcase-hud.spec.ts` picks Studio and checks its toast.

## Toasts

When a mode or an effect changes, the page shows a short translucent toast at the top center of the view, such as `camera: manual`, `Bloom: on` or `time of day: night`. It fades in and out over about 2 s, one replaces the old, it never takes a click, and its text names no input device. It comes from the same control model the HUD draws, so every group has it. `prefers-reduced-motion` shows it with no slide.

A takeover from the HUD halts the route at once ([D-170](D-170-showcase-camera.md#a-takeover-halts-the-route-at-once)). The pose passes the clearance guard, so a takeover never lands inside geometry.

## The loading overlay

`examples/lib/run.ts` shows a glass overlay over the canvas before the engine starts. It names the engine's start stages (`core`, `sketch`, `first-frame`) through `onProgress`, and any progress a scene posts while it loads. `examples/lib/progress.ts` reports a scene's file count from `assets.onProgress`; a scene with nothing to load posts its build phases. The overlay fades out when the first frame draws, with a short fade that `prefers-reduced-motion` removes, and shows the error text instead when the start fails.

## The effects a scene opens with

The showcase scenes open on the look the owner approved. Automatic exposure and the vignette start off, and so does bloom, except in Creek, which opens with its bloom on for the look of its stream and flowers. An effect that starts off has its HUD button unpressed, and turning it on shows `bloom: on` and the like. The initial `post` settings match that state, so no `post.set` turns an effect on at setup.

## The stage holds the switches

The stage holds the Sky, Fog and Environment switches and leaves out each part that is off. A part turned off with one call to the scene comes back, because the stage writes it again on the next frame. The HUD test reads the canvas to check that the part stays off, since a toast can say "off" while the fog stays.

The fog switch owns a scene's own haze. Creek's mist over the water and Night town's low mist are sprites of their own, so both scenes show them only while the fog is on.

The stage leaves the scene alone once every eased value has reached its target, which saves a frame's setters for a fixed mood. A mood change asks for one whole write whatever the eased values say. The studio writes the scene itself rather than easing into it. Without that whole write, leaving the studio for an hour finds the eased values already on their target and skips the environment light, the fog, the sun and the exposure. The scene then keeps the studio's look, and the HUD's Sky switch brings the sky back without the light that belongs with it. `examples/lib/stage.test.ts` covers a studio visit followed by an hour.

## Listeners and disposal

`createHud` returns `dispose()`, which drops its `keydown` listener on the document, its `pointerdown` listener on the stage and the nodes it added. `startDemo` takes an optional `AbortSignal` that does the same for its wheel and click listeners on the canvas, its loading overlay and the HUD. Without them, a page that starts a second demo in the same document gets two `keydown` handlers, and H toggles the panel twice.

## The bloom blend

The engine's `Bloom.blend` default is `Mix`, which moves each pixel toward the glow by the intensity. At a typical intensity that crushes every pixel that is not glowing, so bloom looks as if it darkens the scene: in the night town the surrounding snow and trees go dark. The showcase scenes set `blend: 'add'` explicitly, which adds the glow as three.js does, and the HUD's bloom toggle does the same. The engine default stays `Mix` for Bevy parity (D-21 owns bloom). Whether it should change to `Add` is the owner's question.

## Skyway drives its car

In Skyway's Manual mode the user drives the hero car, so W, A, S and D fly the car there and pan
the camera in the other showcases. V switches the view from behind the car to its seat. C and H
keep their jobs. A touch screen drives with an on-screen pad. The demos page shows each demo's keys
as key caps under its caption
([D-277](D-277-skyway-driving-and-traffic.md)).

## Options rejected

- One card per group in a grid. It stacks or wraps and grows tall on a phone, so the owner chose tabs, which show fewer rows and less height and still scroll.
- A key for the depth-of-field lens. `D` also pans the Manual camera, so one press in Manual would move the camera, change the lens and post a toast. The Post tab's Depth of field button is the one way to turn the lens on.

## Consequences

- The DOM stays on the page: `examples/lib/hud.ts` owns the shell and its interactions, and `examples/lib/run.ts` owns the help element and the `hud` message. The sketch never touches the DOM.
- The message carries a control model: `examples/lib/controls.ts` holds the types (`HudModel`, `HudGroup`, `HudButton`) and the shared option lists, and each scene builds the groups it supports.
- The shell's CSS lives with the examples' styles. The shell makes its elements and listeners once, and a render only turns buttons on and off, so the frame path allocates nothing.
- The camera group comes from `examples/lib/cinematic.ts`; the scene's own groups come from the scene.
- `.dev/examples.md` describes the HUD in its showcase section.
