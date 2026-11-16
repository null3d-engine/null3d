# Vegetation generation

This note says how the vegetation add-on builds a plant, from the record that describes a species to
the meshes a frame draws. It covers the planned grower, its three options, the level system and its
card levels, the far card, the crown's sparseness and the triangle maximum's path, the connectivity and
colour bars, and the approximations a low maximum may use. [The vegetation species guide](vegetation-species.md)
says which species exist and where each one stands; [Plant review](plant-review.md) holds the standard
a plant is judged by.

Code is named by file, under `packages/vegetation/src/`. A behaviour that matters is named with the file
that holds it.

## The planned grower

A species states its planned growth in its record (`core/record.ts`, the `Planned` type; the oak's
figures are in `species/pedunculate-oak/planned-record.ts`). The grower is `grow/planned.ts`.

- **The plan is made first.** The species' frame is planned once for a seed with its fine fill switched
  off (`grow/frame.ts`). Its stated axes are the bones: a trunk, the great limbs and their boughs. Each
  axis ends in a clump, whose size and depth the frame states. The adult plan is kept per species, seed
  and variant.
- **Growth reveals the adult; it never grows and then cuts.** An age maps to a share of the adult's
  height by the record's height curve. A limb shows the first part of its fixed path, and a clump appears
  as the axis that carries it reaches it. A young plant is the adult at a smaller reveal, with its wood
  slimmed against its height, not a separate plant.
- **The fill clothes each clump.** `grow/planned-fill.ts` grows the twigs inside every clump through its
  depth and places the sockets that carry branch ends. Sockets stand at fixed places for a seed, so an
  element is the same element in every request.
- **Addresses are stable.** An axis keeps its plan index and a socket keeps an address built from its
  clump's id and its slot. A sparser or younger plant's element therefore names the same place as the
  full one's, and the contract pairs them by address.

## The three options

Every planned species takes three options on the same grown structure. A request asks for one state and
the grower builds that state directly.

- **Maturity, from 0 to 1,** is the age share. It sets the reveal, the height, the crown's spread, when
  fruit and flowers appear, and, in the oak, when the crown starts to thin its boughs. A mature plant is
  the full planned adult.
- **Sparseness, from 0 to 1,** thins the grown plant by whole sockets in rank order. Wood that carries
  no kept socket goes. The record states the share each order keeps. At sparseness 1 the trunk, the
  great limbs and the stated least of foliage remain. A sparser plant is a subset of a denser one by
  address and by place.
- **The triangle maximum** is a ceiling on the triangles a level may draw. The plan states what each
  part costs and how far it may be simplified; the level's budget (`lod/budget.ts`) shares the maximum
  out. Every level stays at or under it, and a smaller maximum keeps a subset of a larger one's parts.

A grower refuses no request silently: a maximum below what a plant's least costs is an error that names
the part.

## The level system

A plant is drawn at three levels of detail, plus the far card.

- **The leaf form, level 0,** draws the real branch pieces: a cut branch end with its leaves, a frond or
  a shoot, each on its socket.
- **The first and second card levels, levels 1 and 2,** draw each piece or each clump as crossed card
  planes. A card holds its piece's own size within three hundredths in height, width and depth. A card
  is cut by a hard line that keeps the bake's measured cover at every mip level, so a card set does not
  grow as the eye moves away.
- **The far card** is the impostor: one billboard per plant, drawn from the plant's own bake, at the
  distance where a card set would cost more than it shows. Its bake carries the plant's cover and its
  shade by height; the impostor shader relights it flat, which is why its own bake fixes how dark it
  reads.
- **Clump cards.** Where a maximum cannot pay for rows, a clump is drawn as one clump card centred on
  the clump and grown to cover it. The card shows pictures of the clump's own nearest rows, so a card
  that stands for many shoots reads at their leaf scale.

## The crown's sparseness

Sparseness is a construction, not a cut.

- Each order's sockets take ranks once across the whole plant (`core/rank.ts`). A kept share takes the
  lowest ranks, so a sparser plant is a subset of a denser one.
- The crown's clumps are kept by octant, each octant holding the plant's own share of the sockets within
  a stated bound. A clump's weight is the sockets it carries, so a heavy clump kept where a light one
  went does not thin one side of the crown.
- The oak keeps every bough below maturity 0.5 and thins boughs from 0.5 upward; the crown's leaves
  thin at every maturity. One rule acts on the crown, not two.

## The triangle maximum's path

A maximum is spent in this order.

1. **The crown is paid first.** A clump card costs six triangles. The plan gives the crown its share of
   the maximum before the wood takes its share, so a small maximum still draws a crown.
2. **The wood takes its room.** The trunk and the great limbs draw first, then boughs and branches as
   the maximum allows. The plan states the share each order keeps; the level's allocator fits the parts.
3. **The leaves take what is left,** as rows where they fit and as clump cards below them. A maximum
   down to 500 draws leaf triangles at every maturity.
4. **Every level is checked against its own maximum** by the contract's X cases, and each cap stays
   under it.

## Connectivity and colour

Two bars apply to every level and every setting.

- **Connectivity: a plant hangs together.** The review tool counts the picture's pieces and the pieces
  that meet nothing. A plant is one piece with no floating piece at any level, any sparseness and any
  maximum. A piece that meets only the sky is a generator fault, not a review row.
- **Colour is measured, then isolated.** A colour figure is the review's CIEDE2000 difference between
  picture and drawing, where about 2 is one visible step. A colour change follows a measurement that
  isolates its cause; a species changes only its own textures and tints.

## The approximations a low maximum may use

The owner allows whatever approximation keeps the tree reading as a tree at a low maximum, and the
foliage may be drawn a completely different way there. The grower uses this in three ways, all inside
the grower's own file and all only where a maximum is set:

- A capped clump's card stands at the middle of the wood that draws it, so its picture meets that wood.
- A clump is written to the level larger than its fill, so neighbouring cards meet over the sky bays
  between them.
- Below about 800 triangles the crown keeps only the clumps carried by the trunk and the great limbs,
  which every cap draws. Every cap from 5,000 down to 400 then draws one piece with no floating piece.

With no maximum, a clump's place and size are its patch's own, so the default plant is unchanged.

## Where the work lands

A change to shared generation code is one item on its own line, drawn and judged on that line, and it
lands only by the landing session's word. A merge is resolved hunk by hunk, never by taking one side of
a whole file, and every line either parent added is checked. The twenty species' digests are compared
before and after a merge; a species whose drawn data moves is named in the merge's message with the
cause.
