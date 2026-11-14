# D-316: a fern frond is one bent sheet over its texture, and bracken grows as separate fronds on wood stipes

Status: decided. The frond builder (`packages/vegetation/src/leaf/frond.ts`) is built for pinnate and
bipinnate fronds, with frond ages from crozier to brown. The frond-colony grower
(`grow/frond-colony.ts`) is built. Pending: palm fronds (fan and costapalmate), tripinnate fronds,
the crown-rosette grower and stem surfaces. Ruling 11 parks them with the palms and the tree fern.
Task: none.

Summary: a frond draws as one sheet cut by its texture's alpha. The sheet bends so that each pinna
line arches off the rachis, and the pinnules lift into a V about each costa. Bracken grows as fronds
rising singly from buried rhizome lines. Each frond is a stipe and a rachis, meshed as wood. A
colony of 10 to 17 fronds grows in about 1 ms. Its nearest level takes 3,700 to 26,700 triangles from
the Low tier to the Ultra tier, against a cap of 200,000. Its nearest wood takes 52 to 64 KB.

## Question

How does a fern frond take its shape in space, and how does bracken's colony grow? The reference
set gives bracken a texture of the whole blade, not of one leaflet. Bracken has no crown, and its
bare stipe is black at the soil.

## Rule

The plant core's design asks for pinnate and bipinnate fronds and frond ages. A bracken record must
grow through the core's stages, with the same bytes in Bun and in a job worker. The review rubric and
bracken's fact sheet set the look. Bracken has no crown. Each frond stands alone on a bare stipe about
as long as its blade. The blade bends out near level, and its lowest pinna pair is the longest. The
stipe is black at its base. The owner ruled that quality comes before size. The caps per growth model
are the owner's figures.

## Data

| Measure | One sheet, bent along pinna lines | Strips per pinna, mapped into the blade texture | Pinnule meshes, color from the texture |
| --- | --- | --- | --- |
| Needs the texture's pinna layout | Only the pinna angle, a curve | Every pinna's place and angle | No |
| Where record and texture disagree | Bends sit a little off; no gap | Pinnae cut short or doubled | Lobes do not match the color |
| Triangles a frond, High and Ultra tiers | about 560 and 1,400 | about 400 to 800 | 10,000 or more |
| Largest move of a point for a 0.1 mm step on the flat blade | under 2 mm: the sheet is whole | a tear at each strip's edge | not measured |

| Tier | Nearest level, triangles | First card level | Second card level | Nearest wood | Nearest foliage |
| --- | --- | --- | --- | --- | --- |
| Low | 3,736 | 2,062 | 697 | 52 KB | 31 KB |
| Medium | 5,996 | 2,284 | 697 | 58 KB | 70 KB |
| High | 12,062 | 3,358 | 697 | 61 KB | 179 KB |
| Ultra | 26,658 | 5,492 | 697 | 64 KB | 433 KB |

Each figure is the largest of sixteen growths: variants 0 to 3 in each of the four seasons, seed 11.
The colony grows in a median of 1.0 ms in Bun.

How the data was produced: the bracken test record (`grow/bracken.fixture.ts`) grew through
`growFrondColony`. The wood mesher meshed its wood and the grower's `foliage` its fronds. Each part
was quantised by `quantiseParts`. The runs used Bun 1.4.3 on the Mac at a load average near 70. The
tear measure is in `leaf/frond.test.ts`. The strip and pinnule columns are estimates from the same
frond's pinna and pinnule counts.

## Look

The bent sheet looks better. A CPU picture of the grown colony used bracken's reference blade
(slot 24) as its texture. It reads as the whole-colony and profile references (01-b, 02-b, 18-c).
The fronds stand apart on bare stalks, their blades near level at many heights. Each pinna arches
down off the rachis. Strips mapped into the blade texture cut pinnae wherever the record's layout and
the texture's differ. Up close that shows as torn lace. Pinnule meshes cost ten times the triangles,
and their lobes would not match what the texture paints. Stipes drawn as wood take the bark zones by
height. So a stipe is black at the soil and green above, as references 15 and 16 show. The plant
shader's merged foliage role has no stem surface. A stipe drawn there would take the leaf texture.

## Decision

- **The frond.** The flat blade's points come from the texture's outline. A species with no texture
  leaf draws one from its pinnae. A grid cuts the outline, finer at each tier. Each point lies on the
  pinna line at the record's angle through it, and that line meets the rachis at one place. The point
  goes where that line goes in space. It leaves the rachis's frame there and bends over the pinna's
  length by the record's droop. The pinnules lift into a V about the nearest costa by the record's
  fold. The fold shows only where the grid has two rows or more to a pinna. The map is smooth across
  the blade, so the sheet never tears. Normals come from the bent sheet. The texture's alpha cuts the
  pinnae, pinnules and lobes. So pinnate and bipinnate fronds differ in their texture and in the fold.
- **Frond ages.** One number from 0 to 1 sits on the frond's bud. Below 0.5 the frond is a crozier.
  Its rachis and pinnae roll toward their upper faces, in a coil that tightens to the tip. They unroll
  from the base. At 0.5 the frond is mature. Above it the frond slumps further and browns from its
  pinnae's tips inward.
- **The colony.** Rhizome lines leave the colony's middle at even turns and wander. Fronds rise along
  them at the record's spacing, a little to either side. Each frond is a stipe (`AXIS_STIPE`, rooted at
  the ground) and a rachis (`AXIS_RACHIS`). The rachis leads on from the stipe's top and turns over by
  the record's droop, so the blade is held near level. One bud at the blade's base carries +Y along
  the rachis, +Z the upper face, and the age as its vigor. The foliage reads only the skeleton, so a
  cut frond keeps its blade.
- **Seasons.** In spring every frond is a crozier. Summer has mature fronds and the record's few late
  croziers. Autumn's fronds brown. In winter the dead fronds lie flat in a mat. About a fifth stand as
  broken stipes with no blade.
- **The vertex** of merged foliage was agreed with M1 and G5. Its color bytes hold the wind record,
  the flutter phase and the sky visibility. Its second coordinates hold the share along the frond,
  then the browning. The plant shader mixes a browning leaf toward the record's autumn colors.
- **The wood.** The wood mesher meshes a parentless axis only when it is a stem or a stipe. Both are
  rooted at the ground. A parentless limb still is not meshed. The ground plants' cap on nearest wood
  is the test colony's largest figure per tier, with about 15 per cent to spare. The lead set it so,
  under the owner's rule that quality comes before size.
- **The species box** of a frond colony reaches as far as the rhizome runs, plus the longest frond.

Rejected:

- **Strips per pinna mapped into the blade texture.** They tear the lace wherever the record's layout
  and the texture's differ.
- **Pinnule meshes.** They cost ten times the triangles, and their lobes do not match the texture.
- **Stipes in the merged foliage.** The foliage role has no stem surface and no bark zones by height.
- **A frond colony with no wood.** It keeps the ground cap of zero, but loses the black stipe base.

## Consequences

- `leaf/leaf-mesh.ts` gains `cutLeaf(outline, cut)`: the leaf's triangulation with the grid given.
- `wood/wood-mesh.ts` meshes parentless `AXIS_STIPE` axes as it meshes stems.
- `core/caps.ts` gives ground plants a cap on nearest wood above zero.
- `core/box.ts` widens a frond colony's box by its rhizome and frond lengths.
- Bracken's species package writes its record from the test record. Its blade textures come from
  slots 24 and 25, and its stipe's two zones from slots 15 and 16. It tunes the pinna angle curve to
  its texture.
- A dead winter stipe that lies flat takes the black zone along its whole length, since the zones go
  by height. The species package decides whether winter needs its own stipe color.
