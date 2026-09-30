//! Render layers: 32-bit masks that choose which views draw which sources.
//!
//! Every scene object, every instance batch and every view has a mask, and bit `n` of an object's
//! mask puts the object on layer `n`. A view draws a source when their masks share a bit, so a
//! source with no layer draws in no view. An object's mask applies to the object alone: its
//! children keep their own masks, as three.js's layers do. Culling tests the masks every frame,
//! so a mask change needs no rebuild of the draw tables.

/// The mask of a new object, instance batch or camera: layer 0 alone, as in three.js.
pub const DEFAULT_LAYERS: u32 = 1;
/// A mask with every layer.
pub const ALL_LAYERS: u32 = u32::MAX;

/// True when a source on the layers of `mask` draws in a view of the layers of `view`.
#[inline(always)]
pub const fn shares_layer(mask: u32, view: u32) -> bool {
    mask & view != 0
}
