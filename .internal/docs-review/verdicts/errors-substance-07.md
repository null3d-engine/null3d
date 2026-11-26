# errors-substance-07

## Finding as given

- page: errors/E1101
- anchor: "Its slot may already hold a new object."
- category: wrong-claim, severity: medium
- claim: The cause hints that the stale call may change the new object in the slot. The handles concept says it never does, in any build. The page also leaves out three facts. The check runs in development builds only. In release builds the setter writes to an unused row. The core logs E1101 for queued changes.
- evidence: docs/concepts/handles.md:73-75; errors/checks.ts:41-50; scene/scene.ts:1146-1149.
- proposedEdit: Cause: 'A call used an object after you destroyed it. Development builds check every call on an object, and the engine core checks the changes that wait for the next frame. The call never changes another object that now uses the same slot.' Add a details block on release builds: the setter writes to an unused row, a second destroy() frees nothing, and batch arrays and world getters throw in every build. Link concepts/handles.
- generatedSource: packages/engine/src/errors/codes.ts

Verdict: partly

## Evidence

What holds:
- docs/errors/E1101.md:13 says "Its slot may already hold a new object." The sentence is true (slots are reused), but it is the only hint on the page and it suggests a risk that the engine removes. docs/concepts/handles.md:75 says a call on a destroyed object never changes the object that takes its slot, in any build. The code agrees: scene.ts:1086-1090 (row 0 "which no object has") and destroy() at scene.ts:1470-1485 sets the row to 0 and marks the handle's generation dead.
- The page has no link to concepts/handles.md, where the full story lives.
- The core does report E1101 for queued changes: errors/core-failure.ts:100-104, and fixes.ts:19 (E1106 fix names E1101 for a destroyed parent).

What does not hold:
- "The check runs in development builds only" is wrong as a claim about E1101. Only the scene-object check (checkLive, errors/checks.ts:41-50) runs inside `if (DEV)`. Many E1101 throws run in every build: a mesh's id getter (scene/resources.ts:495-498), a canvas texture's refresh (scene/textures.ts:443-446), colour tables (scene/lut.ts:65-68), probes (scene/probes.ts:117-119), environments (scene/environment.ts:66-69, 114-117), instance batch arrays (concepts/instances.md:176). The error page covers all of these, so a cause that says "development builds check" would mislead a reader who meets E1101 from a mesh or texture in a release build.
- The proposed sentence "The call never changes another object" is too absolute for batches. docs/concepts/instances.md:176: an array read before the batch's destroy "can point at memory that the engine gives to another batch."
- The proposed cause has three sentences. The cause field is "one or two sentences" (codes.ts:13-14), and it also fills the page summary and a single cell of the errors index table (tools/lib/docs.ts:442, 466). Release-build and core detail belongs in the details block, not the cause.
- A details block cannot be added by editing codes.ts text alone. ErrorEntry has only title, cause, fix, example, since (codes.ts:10-21), and the renderer (tools/lib/docs.ts:440-460) writes only those. The edit needs a new optional field and renderer support.

## Corrected claim

The cause's second sentence hints that a stale call may change the new object in the reused slot. For scene objects it never does, in any build (concepts/handles.md:75). The page does not link concepts/handles.md and does not say how builds differ: development builds check every call on a scene object, release builds skip that check and the call writes to a row no object uses, and the core logs E1101 for a queued change to a destroyed object. Meshes, textures, colour tables, probes, environments, batch calls and batch arrays throw E1101 in every build.

## Corrected edit

- codes.ts, E1101 cause (two sentences): "A call used an object, instance batch or resource after you destroyed it. The engine reuses the freed slot, but a call through the old handle never changes the object that takes it."
- Add an optional details field to ErrorEntry in packages/engine/src/errors/codes.ts, and render it in the error page code in tools/lib/docs.ts as a `<details>` block after "How to fix it":

  <details>
  <summary>Technical details: which builds check</summary>

  Development builds check every call on a scene object. Release builds skip that check: a destroyed object's setters write to a row that no object uses, and a second `destroy()` frees nothing. The engine core checks each change that waits for the next frame and logs E1101 for a change to a destroyed object, such as a destroyed parent. Meshes, textures, colour tables, probes, environments and instance batches throw E1101 in every build, and so do a batch's array getters. An array that you read from a batch before its destroy can point at memory that another batch now uses. See [Handles](../concepts/handles.md#stale-handles).

  </details>

- Add a link to concepts/handles.md (the Stale handles section) on the page, in the details block or after the fix.
