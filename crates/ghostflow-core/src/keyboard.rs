//! Host independent keyboard to boolean input mapping.
//!
//! The mapper is deliberately separate from terminal I/O. A host can apply
//! explicit `Down`/`Up` edges or use `toggle`, which is the terminal host
//! behavior for numeric keys.

use std::collections::BTreeMap;

use crate::{Error, Result, Value};

/// A numeric keyboard event.  `key` is one of the ASCII digit values 1..=8.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyEvent {
    Down(u8),
    Up(u8),
}

impl KeyEvent {
    pub fn key(self) -> u8 {
        match self {
            Self::Down(key) | Self::Up(key) => key,
        }
    }

    pub fn is_down(self) -> bool {
        matches!(self, Self::Down(_))
    }
}

/// Maps keys 1..=8 to named boolean inputs and retains their current state.
#[derive(Clone, Debug)]
pub struct KeyboardMapper {
    bindings: [Option<String>; 8],
    states: BTreeMap<String, bool>,
}

impl KeyboardMapper {
    /// Creates a mapping.  Each entry corresponds to key `index + 1`.
    /// `None` leaves that key unbound.
    pub fn new(bindings: [Option<String>; 8]) -> Result<Self> {
        let mut states = BTreeMap::new();
        for name in bindings.iter().flatten() {
            if name.trim().is_empty() {
                return Err(Error::new("keyboard input name must not be empty"));
            }
            if states.insert(name.clone(), false).is_some() {
                return Err(Error::new("keyboard inputs must be unique"));
            }
        }
        Ok(Self { bindings, states })
    }

    pub fn binding(&self, key: u8) -> Option<&str> {
        key.checked_sub(1)
            .and_then(|index| self.bindings.get(usize::from(index)))
            .and_then(Option::as_deref)
    }

    /// Applies one explicit edge and returns the complete state of all bound inputs.
    /// Events for unbound keys are ignored, which lets a host retain a fixed
    /// numeric keypad without requiring every key in a module.
    pub fn apply(&mut self, event: KeyEvent) -> Result<&BTreeMap<String, bool>> {
        if !(1..=8).contains(&event.key()) {
            return Err(Error::new("keyboard key must be between 1 and 8"));
        }
        if let Some(name) = self.binding(event.key()).map(str::to_owned) {
            self.states.insert(name, event.is_down());
        }
        Ok(&self.states)
    }

    /// Toggles a bound input and returns the resulting edge event.
    pub fn toggle(&mut self, key: u8) -> Result<KeyEvent> {
        if !(1..=8).contains(&key) {
            return Err(Error::new("keyboard key must be between 1 and 8"));
        }
        let next = self
            .binding(key)
            .and_then(|name| self.states.get(name))
            .map_or(true, |value| !*value);
        let event = if next {
            KeyEvent::Down(key)
        } else {
            KeyEvent::Up(key)
        };
        self.apply(event)?;
        Ok(event)
    }

    pub fn values(&self) -> impl Iterator<Item = (&str, Value)> {
        self.states
            .iter()
            .map(|(name, value)| (name.as_str(), Value::Bool(*value)))
    }

    pub fn inputs(&self) -> impl Iterator<Item = &str> {
        self.states.keys().map(String::as_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapper() -> KeyboardMapper {
        KeyboardMapper::new([
            Some("start".into()),
            Some("stop".into()),
            None,
            None,
            None,
            None,
            None,
            None,
        ])
        .unwrap()
    }

    #[test]
    fn keydown_sets_only_bound_input_and_keyup_clears_it() {
        let mut mapper = mapper();
        mapper.apply(KeyEvent::Down(1)).unwrap();
        assert_eq!(
            mapper.values().collect::<Vec<_>>(),
            vec![("start", Value::Bool(true)), ("stop", Value::Bool(false))]
        );
        mapper.apply(KeyEvent::Down(2)).unwrap();
        mapper.apply(KeyEvent::Up(1)).unwrap();
        assert_eq!(
            mapper.values().collect::<Vec<_>>(),
            vec![("start", Value::Bool(false)), ("stop", Value::Bool(true))]
        );
    }

    #[test]
    fn unbound_key_is_a_noop_and_invalid_key_is_rejected() {
        let mut mapper = mapper();
        let before = mapper
            .values()
            .map(|(name, value)| (name.to_owned(), value))
            .collect::<Vec<_>>();
        mapper.apply(KeyEvent::Down(8)).unwrap();
        let after = mapper
            .values()
            .map(|(name, value)| (name.to_owned(), value))
            .collect::<Vec<_>>();
        assert_eq!(after, before);
        assert!(mapper.apply(KeyEvent::Down(0)).is_err());
        assert!(mapper.apply(KeyEvent::Up(9)).is_err());
    }

    #[test]
    fn duplicate_bindings_are_rejected() {
        let mut bindings: [Option<String>; 8] = Default::default();
        bindings[0] = Some("same".into());
        bindings[1] = Some("same".into());
        assert!(KeyboardMapper::new(bindings).is_err());
    }

    #[test]
    fn toggle_flips_a_bound_input() {
        let mut mapper = mapper();
        assert_eq!(mapper.toggle(1).unwrap(), KeyEvent::Down(1));
        assert_eq!(mapper.toggle(1).unwrap(), KeyEvent::Up(1));
        assert!(mapper.toggle(0).is_err());
    }
}
