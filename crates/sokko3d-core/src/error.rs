//! Errors the core returns. Each error has a numeric code for the TypeScript error table and two
//! detail numbers that complete its message.

use std::fmt;

/// A fixed-capacity store that can run out of room.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum Resource {
    /// Scene object slots.
    Slots = 1,
    /// Instance batch ids.
    Batches = 2,
    /// Records in the command ring.
    Commands = 3,
    /// Tasks in the background queue.
    BackgroundTasks = 4,
    /// Bytes in a frame arena.
    FrameArena = 5,
}

/// An error from the core. [`CoreError::code`] gives the number the TypeScript error table uses,
/// and [`CoreError::details`] gives the two numbers its message shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CoreError {
    /// Code 1101: the handle names an object that was destroyed. Details: the slot, and the
    /// frame the object was destroyed in.
    StaleHandle {
        /// The slot the handle points at.
        slot: u32,
        /// The frame in which the slot's object was destroyed.
        destroyed_frame: u32,
    },
    /// Code 1102: a fixed-capacity store is full. Details: the [`Resource`] number, and the
    /// store's capacity.
    CapacityExceeded {
        /// The store that is full.
        resource: Resource,
        /// Its capacity, in the store's own unit (slots, records, tasks or bytes).
        capacity: u32,
    },
    /// Code 1103: the value was never a handle: slot 0, a slot past the capacity, or bits set
    /// above the 30 handle bits. Details: the raw value, and zero.
    InvalidHandle {
        /// The raw 32-bit value.
        raw: u32,
    },
    /// Code 1104: the new parent is the object itself or one of its descendants. Details: the
    /// object's slot, and the parent's slot.
    HierarchyCycle {
        /// The object being moved.
        slot: u32,
        /// The requested parent.
        parent: u32,
    },
    /// Code 1105: a command record has an operation number the core does not know. Details: the
    /// operation number, and zero.
    UnknownCommand {
        /// The low byte of the record's operation word.
        op: u32,
    },
    /// Code 1106: the handle is reserved, but its create command has not been applied yet.
    /// Details: the slot, and zero.
    NotCreated {
        /// The slot of the object.
        slot: u32,
    },
    /// Code 1107: a create command names an object that already exists. Details: the slot, and
    /// zero.
    AlreadyCreated {
        /// The slot of the object.
        slot: u32,
    },
    /// Code 1108: a number is past its limit, such as a row past a batch's capacity. Details: the
    /// number, and the limit it must stay below or equal to, as the call documents.
    OutOfRange {
        /// The value that was passed.
        value: u32,
        /// The limit.
        limit: u32,
    },
}

impl CoreError {
    /// Code of [`CoreError::StaleHandle`].
    pub const STALE_HANDLE: u32 = 1101;
    /// Code of [`CoreError::CapacityExceeded`].
    pub const CAPACITY_EXCEEDED: u32 = 1102;
    /// Code of [`CoreError::InvalidHandle`].
    pub const INVALID_HANDLE: u32 = 1103;
    /// Code of [`CoreError::HierarchyCycle`].
    pub const HIERARCHY_CYCLE: u32 = 1104;
    /// Code of [`CoreError::UnknownCommand`].
    pub const UNKNOWN_COMMAND: u32 = 1105;
    /// Code of [`CoreError::NotCreated`].
    pub const NOT_CREATED: u32 = 1106;
    /// Code of [`CoreError::AlreadyCreated`].
    pub const ALREADY_CREATED: u32 = 1107;
    /// Code of [`CoreError::OutOfRange`].
    pub const OUT_OF_RANGE: u32 = 1108;

    /// The number of this error in the TypeScript error table.
    pub const fn code(&self) -> u32 {
        match self {
            Self::StaleHandle { .. } => Self::STALE_HANDLE,
            Self::CapacityExceeded { .. } => Self::CAPACITY_EXCEEDED,
            Self::InvalidHandle { .. } => Self::INVALID_HANDLE,
            Self::HierarchyCycle { .. } => Self::HIERARCHY_CYCLE,
            Self::UnknownCommand { .. } => Self::UNKNOWN_COMMAND,
            Self::NotCreated { .. } => Self::NOT_CREATED,
            Self::AlreadyCreated { .. } => Self::ALREADY_CREATED,
            Self::OutOfRange { .. } => Self::OUT_OF_RANGE,
        }
    }

    /// The two numbers that complete the error's message. Each variant documents their meaning.
    pub const fn details(&self) -> [u32; 2] {
        match *self {
            Self::StaleHandle {
                slot,
                destroyed_frame,
            } => [slot, destroyed_frame],
            Self::CapacityExceeded { resource, capacity } => [resource as u32, capacity],
            Self::InvalidHandle { raw } => [raw, 0],
            Self::HierarchyCycle { slot, parent } => [slot, parent],
            Self::UnknownCommand { op } => [op, 0],
            Self::NotCreated { slot } | Self::AlreadyCreated { slot } => [slot, 0],
            Self::OutOfRange { value, limit } => [value, limit],
        }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let code = self.code();
        match *self {
            Self::StaleHandle {
                slot,
                destroyed_frame,
            } => write!(
                f,
                "E{code}: the object in slot {slot} was destroyed in frame {destroyed_frame}; stop using its handle"
            ),
            Self::CapacityExceeded { resource, capacity } => write!(
                f,
                "E{code}: the {resource:?} store is full at {capacity}; raise its capacity when you create the engine"
            ),
            Self::InvalidHandle { raw } => write!(
                f,
                "E{code}: {raw:#x} is not a handle; pass a value that a create call returned"
            ),
            Self::HierarchyCycle { slot, parent } => write!(
                f,
                "E{code}: slot {parent} is slot {slot} or one of its descendants, so it cannot be its parent"
            ),
            Self::UnknownCommand { op } => write!(
                f,
                "E{code}: command operation {op} is unknown; the command ring holds a corrupt record"
            ),
            Self::NotCreated { slot } => write!(
                f,
                "E{code}: the object in slot {slot} is reserved but not created yet; queue its create command first"
            ),
            Self::AlreadyCreated { slot } => write!(
                f,
                "E{code}: the object in slot {slot} already exists; create each handle once"
            ),
            Self::OutOfRange { value, limit } => {
                write!(f, "E{code}: {value} is past the limit of {limit}")
            }
        }
    }
}

impl std::error::Error for CoreError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_and_details() {
        let e = CoreError::StaleHandle {
            slot: 7,
            destroyed_frame: 42,
        };
        assert_eq!(e.code(), 1101);
        assert_eq!(e.details(), [7, 42]);
        let e = CoreError::CapacityExceeded {
            resource: Resource::Slots,
            capacity: 10,
        };
        assert_eq!(e.code(), 1102);
        assert_eq!(e.details(), [1, 10]);
        assert_eq!(CoreError::InvalidHandle { raw: 0 }.code(), 1103);
        assert!(e.to_string().starts_with("E1102"));
    }
}
