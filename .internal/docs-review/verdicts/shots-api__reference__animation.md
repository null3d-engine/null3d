# Verdicts: api/reference/animation (shots and demo links)

The page is generated. Each link must go into the TSDoc comment of the export, in
packages/engine/src/scene/animation.ts (Animator, LookAtOptions, StopOptions, AnimationEvent)
or packages/engine/src/scene/property-animation.ts (PropertyAnimation, PropertyKeyframes).
No TSDoc comment in packages/*/src carries a demo link today.

## Shots

None proposed. Reference images exist for all three demos (demo-character.png,
demo-look-at.png, demo-property-animation.png in webgpu, compat and webgl2), but a reference
page does not need pictures; the overview page (api/animation) is the better place.

## Demo links

- character/ at `Animator` - KEEP. The sketch calls playBlend, setBlend, setLayerMask(1, 'spine'),
  play on layer 1 with fade and loop false, onEvent('finished') and stop with a fade.
  It does not show crossFade, setLayerWeight, additive clips or joint calls.
  URL: https://github.com/null3d-engine/null3d/tree/main/examples/character
- look-at/ at `LookAtOptions` - KEEP. The sketch keeps a frozen options object with joints
  (spine, chest, head), limit per joint and shares, and calls animator.lookAt(place, LOOK) and
  later lookAt(place) to follow the wisp. It does not set forward.
  URL: https://github.com/null3d-engine/null3d/tree/main/examples/look-at
- property-animation/ at `PropertyAnimation` - KEEP, but move it to `PropertyKeyframes`.
  The sketch shows keyframes well: cubic keys with tangents, linear keys, a start time offset,
  and light, camera, material and position targets. It drops the PropertyAnimation that
  animateProperty returns and never calls setTime, setPaused, setLoop, setSpeed or stop, so
  under `PropertyAnimation` the link promises what the demo does not show.
  URL: https://github.com/null3d-engine/null3d/tree/main/examples/property-animation

## Concepts said to have no demo

- AnimationEvent handlers - WRONG. character/ calls animator.onEvent('finished', ...) and reads
  event.clip to end its sword swing. Link character/ at `AnimationEvent` or `AnimationEventHandler`.
- StopOptions - WRONG. character/ keeps a frozen { fade: 0.25 } and calls
  animator.stop(SWING, FADE_OUT). Link character/ at `StopOptions`.
