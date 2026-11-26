# start-readability-29

## Finding as given

- page: cli/null3d
- anchor: ### Objects in a script (lines 158 to 172)
- category: technical-details-block
- severity: low
- claim: Lines 160 to 166 explain where set and dump split names at the last dot, the case that cannot be dumped, and the properties per object kind. A script author needs 'name, dot, property' and the property list; the dot edge cases are rare.
- evidence: cli/null3d.md lines 160, 162, 164, 166.
- proposedEdit: Keep one sentence ('A step names an object by its scene name, then a dot and a property, such as ship.position. #camera names the active camera.') and a table Object kind | set writes | dump reads. Move lines 160 to 162 into <summary>Technical details: names that hold dots</summary>.

Verdict: partly

## Evidence

- docs/cli/null3d.md lines 160 to 166 say what the finding says. Line 160: set splits at the last dot, example `Cube.001.position`. Line 162: dump splits only when the word after the last dot is a property name, so an object whose name ends in such a word cannot be dumped whole. Line 164: properties that set takes, per object kind. Line 166: the smaller set that dump reads.
- The page matches the code. packages/cli/src/script.js:161-169 (readTargetPath) splits a set target at the last dot. packages/cli/src/script.js:228-233 splits a dump name only when the part after the last dot is in the list of property names.
- None of these paragraphs is in the stats.json list of long paragraphs. So this is a structure proposal, not a length fix.
- The table is a real gain. Lines 164 and 166 give two lists that differ: set writes a light's `intensity`, `range`, `decay`, `angle` and `penumbra`, and dump does not read them. A table with columns for set and dump shows that gap at a glance.
- The "rare" part is wrong for set. Object names with dots are common: Blender gives copies names like `Cube.001`, and glTF exports keep them. The code comment at script.js:154-155 gives glTF node names as the reason for the rule. The dump case (a name that ends in a word such as `position`) is rare.
- Both rules do what a reader would guess. `Cube.001.position` works, and `dump Cube.001` dumps the whole object, because `001` is not a property name. So the reasoning can go in a block and the main text still makes sense with the block closed.
- The proposed main sentence drops line 164's link to `animateProperty`, which tells the reader where the full property list comes from. Keep it.

## Corrected claim

Lines 160 to 166 mix the "name, dot, property" rule, the reasoning about names that hold dots, and two property lists that differ. Names that hold dots are common in glTF scenes (Blender's `Cube.001`), but both splitting rules do what a reader expects. Only the dump case of a name that ends in a property word is rare. The two lists read better as one table.

## Corrected edit

Main text: "A step names an object by the name that the scene gave it, then a dot and a property, such as `car.position`. The name may hold dots of its own: `Cube.001.position` names the position of `Cube.001`. `#camera` names the active camera. A property is one that `animateProperty` takes." Then a table with the columns Object kind, set writes and dump reads, and the rows "Every object", "Camera" and "Light".

Then:

<details>
<summary>Technical details: names that hold dots</summary>

A `set` step splits the name from the property at the last dot. A `dump` step splits at the last dot only when the word after it is a property name, such as `position`. So an object whose own name ends in such a word cannot be dumped whole.

</details>

Keep the "Names that are close" paragraph and its example in the main text.
