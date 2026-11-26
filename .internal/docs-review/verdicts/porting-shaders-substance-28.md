# porting-shaders-substance-28

Finding as given:

- page: porting/threejs-loop-and-threads
- anchor: ## Converting the loop, lines 76-78 and 92 (physicsWorld.step())
- category: unclear; severity: low
- claim: A step with no argument fits Rapier only. cannon-es, which the page names at line 208, needs the step as its first argument, so a copied cannon-es port steps by nothing.
- evidence: docs/porting/threejs-loop-and-threads.md:208 (cannon-es, Rapier, Ammo)
- proposedEdit: Write 'physicsWorld.step(1 / 60); // cannon-es. Rapier's world.step() takes world.timestep', or say 'the fixed step, 1 / fixedRate'.

Verdict: survives

Evidence:

- docs/porting/threejs-loop-and-threads.md:64 The three.js "before" loop calls `physicsWorld.step(1 / 60, dt, 3)`. That is the cannon-es signature (fixed step, time since last call, max substeps). Rapier's `world.step()` takes no time argument, and Ammo uses `stepSimulation`. So the page's own example is a cannon-es world.
- docs/porting/threejs-loop-and-threads.md:76-78 The "after" sketch writes `onFixedUpdate() { physicsWorld.step(); ... }`. It drops the `step` argument that the callback receives, and calls step with no length.
- docs/porting/threejs-loop-and-threads.md:92 says "One `world.step()` call per fixed step replaces `world.step(1 / 60, dt, 3)`." For cannon-es, `step(dt)` with dt undefined runs one internal step of undefined length, so bodies get NaN positions or do not move. The reader who copies this breaks the very world the page started from.
- docs/porting/threejs-loop-and-threads.md:208 names cannon-es, Rapier and Ammo.
- docs/guides/physics.md:87-89 (Rapier) uses `onFixedUpdate(step) { world.timestep = step; world.step(); }`, and docs/guides/physics.md:164-165,177 (cannon-es) uses `onFixedUpdate(step) { world.step(step); }`. The linked guide is correct, but the porting page's snippet contradicts it for cannon-es, so the link does not fix the page.
- docs/api/sketch.md:171,175 `onFixedUpdate(step)` receives the fixed step length in seconds.

Corrected edit (better than the proposed one):

The proposed `1 / 60` hardcodes the default rate. It goes wrong when `fixedRate` changes, which the bullet on line 92 mentions. Use the callback's argument instead:

```ts
onFixedUpdate(step) {
  physicsWorld.step(step);
  syncBodies();
},
```

and line 92: "Physics moves to `onFixedUpdate(step)`. ... `step` is the length of one fixed step. `world.step(step)` replaces `world.step(1 / 60, dt, 3)` in cannon-es. In Rapier, set `world.timestep = step` and call `world.step()`."

Severity note: a copied cannon-es port does not step correctly, so this misleads a reader. Medium fits better than low.
