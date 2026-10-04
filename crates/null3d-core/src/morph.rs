//! Morph weights: how far each morphed object's mesh moves toward each of its morph targets.
//!
//! # Blocks
//!
//! Each morphed object owns a block of weights, one per target of its mesh, in one table of
//! [`MAX_WEIGHTS`] floats. TypeScript writes a block's weights straight into the table, so a sketch
//! can change them every frame for free, and the scene command `SET_MORPH` links the block to the
//! object. The table never moves once it exists, so the views of it stay good until the engine's
//! memory grows.
//!
//! # Weights that clips animate
//!
//! A clip animates a model's morph weights through joints of the model's skeleton that move no
//! vertex, three weights per joint, as [`morph_joint`] says. A block that such joints animate is
//! linked to its animated instance and to the first of its joints. Each frame then takes the
//! weight that the pose gives, as [`MorphWeights::weight`] says.

use crate::error::{CoreError, Resource};

/// The weights that the table holds.
pub const MAX_WEIGHTS: u32 = 65_536;
/// The most targets that one block holds.
pub const MAX_TARGETS: u32 = 256;
/// The link of a block that no animated instance animates.
pub const NOT_LINKED: u32 = u32::MAX;
/// The weights that one joint of a skeleton animates: one along each axis of its translation.
pub const WEIGHTS_PER_JOINT: u32 = 3;

/// One block of weights.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Block {
    /// Its first weight in the table.
    pub first: u32,
    /// Its weights, 0 for a free block.
    pub count: u32,
    /// The weights it has room for.
    capacity: u32,
    /// The animated instance whose pose animates its weights, or [`NOT_LINKED`].
    pub instance: u32,
    /// The instance skeleton's first joint that animates the weights.
    pub joint: u32,
}

/// The table of morph weights and its blocks.
#[derive(Debug)]
pub struct MorphWeights {
    values: Vec<f32>,
    blocks: Vec<Block>,
    /// The first weight that no block has used yet.
    end: u32,
}

/// The morph weight of a block's target `k` as a frame draws it: the user's weight `own`, or
/// where linked, the weight that the pose of joints `matrices` gives, 12 floats per joint from the
/// block's first joint on.
///
/// The model's skeleton holds each weight in the translation of a joint at rest at the origin, and
/// the share of the clips that animate it in the joint's scale, which is 0 at rest and 1 in each
/// clip that has the weight's track. Blending then gives `t`, the clips' weights times their
/// shares, and `s`, the shares' sum, and the weight is `t + (1 - s) * own`. A clip at full weight
/// sets the weight, a fade blends it with the user's, and the user's weight holds when no clip
/// animates it. three.js's `AnimationMixer` blends a property with its value before the clips
/// started in the same way.
#[inline]
pub fn posed_weight(own: f32, matrices: &[f32], k: usize) -> f32 {
    let (joint, axis) = (
        k / WEIGHTS_PER_JOINT as usize,
        k % WEIGHTS_PER_JOINT as usize,
    );
    let m = &matrices[joint * 12..joint * 12 + 12];
    let row = &m[axis * 4..axis * 4 + 4];
    row[3] + (1.0 - row[axis]) * own
}

/// The joint that animates target `k` of a block whose first joint is `first`, and the axis of
/// its translation that holds the weight.
pub const fn morph_joint(first: u32, k: u32) -> (u32, u32) {
    (first + k / WEIGHTS_PER_JOINT, k % WEIGHTS_PER_JOINT)
}

impl Default for MorphWeights {
    fn default() -> Self {
        Self::new()
    }
}

impl MorphWeights {
    /// An empty table, which allocates when its first block is made.
    pub const fn new() -> Self {
        Self {
            values: Vec::new(),
            blocks: Vec::new(),
            end: 0,
        }
    }

    /// The table's weights: [`MAX_WEIGHTS`] floats once a block exists, else none.
    pub fn values(&self) -> &[f32] {
        &self.values
    }

    /// The table's weights, to write.
    pub fn values_mut(&mut self) -> &mut [f32] {
        &mut self.values
    }

    /// The block with id `id`, or `None` for an id that names no live block.
    pub fn block(&self, id: u32) -> Option<&Block> {
        self.blocks.get(id as usize).filter(|b| b.count > 0)
    }

    /// The weights of block `id`, or none for an id that names no live block.
    pub fn weights(&self, id: u32) -> &[f32] {
        match self.block(id) {
            Some(b) => &self.values[b.first as usize..(b.first + b.count) as usize],
            None => &[],
        }
    }

    /// Makes a block of `count` weights, all 0, and returns its id. It takes the room of a freed
    /// block with enough of it, or new room at the table's end.
    pub fn create(&mut self, count: u32) -> Result<u32, CoreError> {
        if count == 0 || count > MAX_TARGETS {
            return Err(CoreError::OutOfRange {
                value: count,
                limit: MAX_TARGETS,
            });
        }
        if self.values.is_empty() {
            self.values = crate::alloc::filled(MAX_WEIGHTS as usize, 0.0).map_err(|_| {
                CoreError::OutOfMemory {
                    bytes: MAX_WEIGHTS * 4,
                }
            })?;
        }
        let free = self
            .blocks
            .iter()
            .enumerate()
            .filter(|(_, b)| b.count == 0 && b.capacity >= count)
            .min_by_key(|(_, b)| b.capacity)
            .map(|(k, _)| k);
        let id = match free {
            Some(k) => k,
            None => {
                if self.end + count > MAX_WEIGHTS {
                    return Err(CoreError::CapacityExceeded {
                        resource: Resource::MorphWeights,
                        capacity: MAX_WEIGHTS,
                    });
                }
                self.blocks
                    .try_reserve(1)
                    .map_err(|_| CoreError::OutOfMemory { bytes: 20 })?;
                self.blocks.push(Block {
                    first: self.end,
                    count: 0,
                    capacity: count,
                    instance: NOT_LINKED,
                    joint: 0,
                });
                self.end += count;
                self.blocks.len() - 1
            }
        };
        let block = &mut self.blocks[id];
        block.count = count;
        block.instance = NOT_LINKED;
        block.joint = 0;
        let first = block.first as usize;
        self.values[first..first + count as usize].fill(0.0);
        Ok(id as u32)
    }

    /// Frees block `id`, whose room a later block can take.
    pub fn destroy(&mut self, id: u32) -> Result<(), CoreError> {
        let block = self.live(id)?;
        block.count = 0;
        Ok(())
    }

    /// Links block `id` to animated instance `instance`, whose skeleton's joints from `joint` on
    /// animate its weights, or with `None`, unlinks it.
    pub fn link(&mut self, id: u32, link: Option<(u32, u32)>) -> Result<(), CoreError> {
        let block = self.live(id)?;
        (block.instance, block.joint) = link.unwrap_or((NOT_LINKED, 0));
        Ok(())
    }

    fn live(&mut self, id: u32) -> Result<&mut Block, CoreError> {
        let limit = self.blocks.len() as u32;
        self.blocks
            .get_mut(id as usize)
            .filter(|b| b.count > 0)
            .ok_or(CoreError::OutOfRange { value: id, limit })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_take_the_room_of_freed_blocks_and_start_at_zero() {
        let mut table = MorphWeights::new();
        let a = table.create(4).unwrap();
        let b = table.create(2).unwrap();
        assert_eq!(table.values().len(), MAX_WEIGHTS as usize);
        table.values_mut()[1] = 0.5;
        assert_eq!(table.weights(a), &[0.0, 0.5, 0.0, 0.0]);
        assert_eq!(table.block(b).unwrap().first, 4);

        table.destroy(a).unwrap();
        assert!(table.block(a).is_none());
        assert!(table.destroy(a).is_err());
        // A smaller block reuses the freed room, cleared.
        let c = table.create(3).unwrap();
        assert_eq!(c, a);
        assert_eq!(table.weights(c), &[0.0; 3]);
        // A larger one goes to the end.
        let d = table.create(5).unwrap();
        assert_eq!(table.block(d).unwrap().first, 6);
        assert!(table.create(0).is_err());
        assert!(table.create(MAX_TARGETS + 1).is_err());
    }

    #[test]
    fn the_table_refuses_blocks_past_its_capacity() {
        let mut table = MorphWeights::new();
        for _ in 0..MAX_WEIGHTS / MAX_TARGETS {
            table.create(MAX_TARGETS).unwrap();
        }
        assert_eq!(
            table.create(1),
            Err(CoreError::CapacityExceeded {
                resource: Resource::MorphWeights,
                capacity: MAX_WEIGHTS,
            })
        );
    }

    #[test]
    fn a_linked_weight_blends_the_pose_with_the_users_weight() {
        // Two joints: weights 0 to 2 on the first, 3 on the second. Translation t, scale s.
        let joint = |t: [f32; 3], s: [f32; 3]| {
            [
                s[0], 0.0, 0.0, t[0], 0.0, s[1], 0.0, t[1], 0.0, 0.0, s[2], t[2],
            ]
        };
        let mut matrices = Vec::new();
        matrices.extend(joint([0.0, 0.3, 0.4], [0.0, 1.0, 0.5]));
        matrices.extend(joint([0.9, 0.0, 0.0], [1.0, 0.0, 0.0]));
        // No clip animates weight 0: the user's holds.
        assert_eq!(posed_weight(0.7, &matrices, 0), 0.7);
        // A clip at full weight sets weight 1.
        assert_eq!(posed_weight(0.7, &matrices, 1), 0.3);
        // A clip at half weight: 0.4 is half of its 0.8, and the user's 0.2 makes up the rest.
        assert!((posed_weight(0.2, &matrices, 2) - 0.5).abs() < 1e-6);
        assert_eq!(posed_weight(0.0, &matrices, 3), 0.9);
        assert_eq!(morph_joint(5, 4), (6, 1));
    }
}
