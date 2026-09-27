//! The material table: each material's parameters in the layout the shaders read by material id,
//! and the pipeline it draws with.

/// How a material shades.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Shading {
    /// Lambert lighting from the sun and ambient light, as three.js's `MeshLambertMaterial`.
    Lit,
    /// The base color only, as three.js's `MeshBasicMaterial`.
    Unlit,
}

/// Material parameters in the GPU layout: a linear base color and opacity.
pub const MATERIAL_FLOATS: usize = 4;

/// Materials by id, with a fixed capacity so the GPU table never moves.
#[derive(Debug)]
pub struct MaterialTable {
    parameters: Vec<f32>,
    shading: Vec<Shading>,
    capacity: u32,
    changed: bool,
}

/// Why a material could not be created.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaterialError {
    /// The table holds its capacity already.
    Full,
    /// No material has this id.
    Unknown(u32),
}

impl MaterialTable {
    pub fn with_capacity(capacity: u32) -> Self {
        Self {
            parameters: Vec::with_capacity(capacity as usize * MATERIAL_FLOATS),
            shading: Vec::with_capacity(capacity as usize),
            capacity,
            changed: false,
        }
    }

    /// Adds a material with a linear color and returns its id, counting from 0.
    pub fn create(&mut self, shading: Shading, color: [f32; 4]) -> Result<u32, MaterialError> {
        if self.shading.len() as u32 >= self.capacity {
            return Err(MaterialError::Full);
        }
        self.parameters.extend_from_slice(&color);
        self.shading.push(shading);
        self.changed = true;
        Ok(self.shading.len() as u32 - 1)
    }

    pub fn set_color(&mut self, id: u32, color: [f32; 4]) -> Result<(), MaterialError> {
        let at = id as usize * MATERIAL_FLOATS;
        let slot = self
            .parameters
            .get_mut(at..at + MATERIAL_FLOATS)
            .ok_or(MaterialError::Unknown(id))?;
        slot.copy_from_slice(&color);
        self.changed = true;
        Ok(())
    }

    pub fn shading(&self, id: u32) -> Result<Shading, MaterialError> {
        self.shading
            .get(id as usize)
            .copied()
            .ok_or(MaterialError::Unknown(id))
    }

    pub fn len(&self) -> u32 {
        self.shading.len() as u32
    }

    pub fn is_empty(&self) -> bool {
        self.shading.is_empty()
    }

    pub fn capacity(&self) -> u32 {
        self.capacity
    }

    /// Every material's parameters, in id order.
    pub fn parameters(&self) -> &[f32] {
        &self.parameters
    }

    /// True once after any change, so the table is uploaded only when it changed.
    pub fn take_changed(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materials_get_ids_in_order_and_report_changes_once() {
        let mut table = MaterialTable::with_capacity(2);
        assert_eq!(table.create(Shading::Lit, [1.0, 0.0, 0.0, 1.0]), Ok(0));
        assert_eq!(table.create(Shading::Unlit, [0.0, 1.0, 0.0, 1.0]), Ok(1));
        assert_eq!(
            table.create(Shading::Lit, [0.0; 4]),
            Err(MaterialError::Full)
        );
        assert!(table.take_changed());
        assert!(!table.take_changed());
        table.set_color(1, [0.5, 0.5, 0.5, 1.0]).unwrap();
        assert!(table.take_changed());
        assert_eq!(&table.parameters()[4..8], &[0.5, 0.5, 0.5, 1.0]);
        assert_eq!(table.shading(1), Ok(Shading::Unlit));
        assert_eq!(table.set_color(2, [0.0; 4]), Err(MaterialError::Unknown(2)));
    }
}
