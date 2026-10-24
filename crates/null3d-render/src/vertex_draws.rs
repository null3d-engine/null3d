//! Draws from a vertex count alone: a scene object whose material is a full shader of the sketch's
//! that makes its vertices from `@builtin(vertex_index)` and its copies from
//! `@builtin(instance_index)`. No mesh data, no per-instance data and no vertex buffer reach the
//! GPU, so the draw costs one call, and the shader computes each streak, card or procedural shape
//! from its two indices and the material's values.
//!
//! # Table
//!
//! The table names the scene object in each slot and holds that draw's two whole numbers: the
//! vertices of one shape and the number of copies. A system that sends the same shape many times
//! sets the second, such as 2 vertices for each streak of rain. The sketch changes either number at
//! any time; a frame reads them from engine memory, so a change uploads nothing.
//!
//! # Drawing
//!
//! The object's scene slot gives its place in the world, its culling sphere, its layers and its
//! place among the transparent pass's sorted objects, as a particle system's does. The sorted pass
//! draws its run as one [`Op::Draw`](null3d_gpu::drawlist::Op) of the vertex count for the
//! instance count, with the pipeline of its material's bucket, and sets no vertex buffer and no
//! index buffer. The pipeline declares no vertex buffers, so the shader makes every vertex.
//!
//! The counts come from a table in engine memory rather than from a buffer, so a frame of 50,000
//! streaks uploads no vertex data for the draw. The material's values carry the animation: time,
//! the camera and the box that the streaks wrap inside.
//!
//! # Bounds
//!
//! The object culls by the sphere that the sketch gives it, with [`setBounds`], as any object
//! does. A draw whose shapes move must give a sphere that holds them all, or several draws each
//! with a sphere of its own.

use std::collections::TryReserveError;

/// The most vertex draws that a scene holds at once.
pub const MAX_DRAWS: usize = 256;
/// The most vertices of one copy that a draw gives.
pub const MAX_VERTICES: u32 = 1 << 20;
/// The most copies that a draw gives.
pub const MAX_INSTANCES: u32 = 1 << 24;

/// One draw's counts: the vertices of one shape and the copies that it draws.
#[derive(Clone, Copy, Debug)]
struct VertexDraw {
    vertices: u32,
    instances: u32,
}

/// The scene's vertex draws, by id from 1.
#[derive(Debug, Default)]
pub struct VertexDrawTable {
    draws: Vec<Option<VertexDraw>>,
    /// Each live draw's object slot and id, by slot.
    by_slot: Vec<(u32, u32)>,
}

impl VertexDrawTable {
    /// Makes a draw of `vertices` vertices for each of `instances` copies for the object in scene
    /// slot `slot`, and returns its id, or 0 when the scene holds the most draws already.
    pub fn create(
        &mut self,
        slot: u32,
        vertices: u32,
        instances: u32,
    ) -> Result<u32, TryReserveError> {
        let vertices = vertices.min(MAX_VERTICES);
        let instances = instances.min(MAX_INSTANCES);
        let free = self.draws.iter().position(Option::is_none);
        let index = match free {
            Some(index) => index,
            None if self.draws.len() < MAX_DRAWS => {
                self.draws.try_reserve(1)?;
                self.draws.push(None);
                self.draws.len() - 1
            }
            None => return Ok(0),
        };
        self.draws[index] = Some(VertexDraw {
            vertices,
            instances,
        });
        let id = index as u32 + 1;
        // A slot whose object died with its draw still made takes the new draw. The old one keeps
        // its place until the sketch destroys it, but draws nothing.
        let at = self.by_slot.partition_point(|&(s, _)| s < slot);
        if self.by_slot.get(at).is_some_and(|&(s, _)| s == slot) {
            self.by_slot[at] = (slot, id);
        } else {
            self.by_slot.try_reserve(1)?;
            self.by_slot.insert(at, (slot, id));
        }
        Ok(id)
    }

    /// Forgets a draw. Its object draws nothing from then on.
    pub fn destroy(&mut self, id: u32) {
        if self.get(id).is_none() {
            return;
        }
        self.draws[id as usize - 1] = None;
        self.by_slot.retain(|&(_, i)| i != id);
    }

    /// Sets the vertices of one shape and the copies of a draw. Returns false for no such draw.
    pub fn set_counts(&mut self, id: u32, vertices: u32, instances: u32) -> bool {
        let Some(draw) = self.get_mut(id) else {
            return false;
        };
        draw.vertices = vertices.min(MAX_VERTICES);
        draw.instances = instances.min(MAX_INSTANCES);
        true
    }

    /// The vertices of one shape and the copies of a draw, or two zeroes for no such draw.
    pub fn counts(&self, id: u32) -> (u32, u32) {
        self.get(id)
            .map_or((0, 0), |draw| (draw.vertices, draw.instances))
    }

    /// The id of the draw whose object is in scene slot `slot`.
    pub fn draw_of(&self, slot: u32) -> Option<u32> {
        let at = self.by_slot.partition_point(|&(s, _)| s < slot);
        self.by_slot
            .get(at)
            .filter(|&&(s, _)| s == slot)
            .map(|&(_, id)| id)
    }

    /// True when the scene holds no vertex draw.
    pub fn is_empty(&self) -> bool {
        self.by_slot.is_empty()
    }

    fn get(&self, id: u32) -> Option<&VertexDraw> {
        self.draws.get((id as usize).wrapping_sub(1))?.as_ref()
    }

    fn get_mut(&mut self, id: u32) -> Option<&mut VertexDraw> {
        self.draws.get_mut((id as usize).wrapping_sub(1))?.as_mut()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_draw_finds_its_object_and_gives_its_counts() {
        let mut table = VertexDrawTable::default();
        assert!(table.is_empty());
        let first = table.create(5, 6, 50_000).unwrap();
        let second = table.create(2, 2, 10).unwrap();
        assert_eq!(table.draw_of(5), Some(first));
        assert_eq!(table.draw_of(2), Some(second));
        assert_eq!(table.draw_of(3), None);
        assert_eq!(table.counts(first), (6, 50_000));
        assert!(!table.is_empty());
    }

    #[test]
    fn a_draw_changes_its_counts_and_the_change_stays_whole() {
        let mut table = VertexDrawTable::default();
        let id = table.create(1, 3, 4).unwrap();
        assert!(table.set_counts(id, 6, 9));
        assert_eq!(table.counts(id), (6, 9));
        // A count past the most is cut to the most, so no shader reads a runaway index.
        assert!(table.set_counts(id, u32::MAX, u32::MAX));
        assert_eq!(table.counts(id), (MAX_VERTICES, MAX_INSTANCES));
        assert!(!table.set_counts(id + 1, 1, 1));
        assert_eq!(table.counts(id + 1), (0, 0));
    }

    #[test]
    fn a_destroyed_draw_draws_nothing_and_its_slot_takes_another() {
        let mut table = VertexDrawTable::default();
        let first = table.create(7, 6, 12).unwrap();
        table.destroy(first);
        assert_eq!(table.draw_of(7), None);
        assert_eq!(table.counts(first), (0, 0));
        let second = table.create(7, 3, 3).unwrap();
        assert_eq!(table.draw_of(7), Some(second));
        // The freed id goes to the next draw.
        assert_eq!(second, first);
        assert!(!table.is_empty());
    }

    #[test]
    fn the_most_draws_are_what_a_scene_holds() {
        let mut table = VertexDrawTable::default();
        for slot in 0..MAX_DRAWS as u32 {
            assert_ne!(table.create(slot, 1, 1).unwrap(), 0);
        }
        assert_eq!(table.create(MAX_DRAWS as u32, 1, 1).unwrap(), 0);
    }
}
