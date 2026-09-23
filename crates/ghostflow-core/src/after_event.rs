//! Fixed-capacity, per-identity event windows. This is a runtime prerequisite;
//! binding an `Event` source and projecting results into GhostFlow signals is
//! a separate contract.

use crate::temporal::{EvidenceQuality, TemporalError, TimeContext};

type Result<T> = std::result::Result<T, TemporalError>;
const MAX_EXACT: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EventKey {
    pub source_tag: u32,
    pub source_epoch: u64,
    pub id: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Event {
    pub key: EventKey,
    pub time_epoch: u64,
    pub at_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Observation {
    pub at_ms: u64,
    pub value: bool,
    pub quality: EvidenceQuality,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Pending,
    Satisfied { at_ms: u64 },
    Expired,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EventResult {
    pub event: Event,
    pub status: Status,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Input {
    Start(Event),
    Predicate(Observation),
    Acknowledge(EventKey),
    Clock,
}

#[derive(Clone, Copy)]
struct State<const N: usize> {
    slots: [Option<EventResult>; N],
    time: Option<TimeContext>,
    last_event: Option<Event>,
}

/// Results stay addressable by event key until explicitly acknowledged.
/// Staging never exposes partial results and has no heap use.
pub struct AfterEvent<const N: usize> {
    window_ms: u64,
    committed: State<N>,
    candidate: Option<State<N>>,
}

impl<const N: usize> AfterEvent<N> {
    pub fn new(window_ms: u64) -> Result<Self> {
        if N == 0 || window_ms == 0 || window_ms > MAX_EXACT {
            return Err(TemporalError::InvalidConfig);
        }
        Ok(Self {
            window_ms,
            committed: State {
                slots: [None; N],
                time: None,
                last_event: None,
            },
            candidate: None,
        })
    }

    pub fn result(&self, key: EventKey) -> Option<EventResult> {
        self.committed
            .slots
            .iter()
            .flatten()
            .find(|result| result.event.key == key)
            .copied()
    }

    pub fn results(&self) -> &[Option<EventResult>; N] {
        &self.committed.slots
    }

    pub fn stage(&mut self, time: TimeContext, input: Input) -> Result<()> {
        let mut next = self.prepare(time)?;
        self.apply_input(time, &mut next, input)?;
        self.candidate = Some(next);
        Ok(())
    }

    /// Stage a complete tick: expire old windows, release acknowledged terminal
    /// results, register starts in source identity order, then apply the measured
    /// predicate to every eligible identity, including starts in this tick.
    /// Any failure discards the entire batch. Acknowledgements cannot consume a
    /// result newly satisfied by this batch's predicate.
    pub fn stage_batch(
        &mut self,
        time: TimeContext,
        starts: &[Event],
        predicate: Option<Observation>,
        acknowledgements: &[EventKey],
    ) -> Result<()> {
        let mut next = self.prepare(time)?;
        for key in acknowledgements {
            self.apply_input(time, &mut next, Input::Acknowledge(*key))?;
        }
        for event in starts {
            self.apply_input(time, &mut next, Input::Start(*event))?;
        }
        if let Some(observation) = predicate {
            self.apply_input(time, &mut next, Input::Predicate(observation))?;
        }
        self.candidate = Some(next);
        Ok(())
    }

    fn prepare(&self, time: TimeContext) -> Result<State<N>> {
        if self.candidate.is_some() {
            return Err(TemporalError::AlreadyStaged);
        }
        if time.epoch > MAX_EXACT || time.now_ms > MAX_EXACT {
            return Err(TemporalError::InvalidIdentity);
        }
        if let Some(previous) = self.committed.time {
            if previous.epoch != time.epoch {
                return Err(TemporalError::IdentityMismatch);
            }
            if previous.now_ms > time.now_ms {
                return Err(TemporalError::ClockBackward);
            }
        }
        let mut next = self.committed;
        for slot in next.slots.iter_mut().flatten() {
            if slot.status == Status::Pending && time.now_ms >= slot.event.at_ms + self.window_ms {
                slot.status = Status::Expired;
            }
        }
        next.time = Some(time);
        Ok(next)
    }

    fn apply_input(&self, time: TimeContext, next: &mut State<N>, input: Input) -> Result<()> {
        match input {
            Input::Start(event) => {
                if event.key.source_tag == 0
                    || event.key.source_epoch > MAX_EXACT
                    || event.key.id > MAX_EXACT
                    || event.time_epoch != time.epoch
                    || event.at_ms > time.now_ms
                    || event
                        .at_ms
                        .checked_add(self.window_ms)
                        .is_none_or(|end| end > MAX_EXACT)
                {
                    return Err(TemporalError::InvalidIdentity);
                }
                if let Some(previous) = next
                    .slots
                    .iter()
                    .flatten()
                    .find(|slot| slot.event.key == event.key)
                {
                    if previous.event != event {
                        return Err(TemporalError::IdentityMismatch);
                    }
                } else if next.last_event == Some(event) {
                    // Acknowledgement releases storage, not the source identity high-water.
                } else {
                    if event.at_ms != time.now_ms {
                        return Err(TemporalError::SampleTimeBackward);
                    }
                    if let Some(last) = next.last_event {
                        if last.key.source_tag != event.key.source_tag
                            || last.key.source_epoch != event.key.source_epoch
                            || event.key.id <= last.key.id
                        {
                            return Err(TemporalError::IdentityMismatch);
                        }
                    }
                    let empty = next
                        .slots
                        .iter_mut()
                        .find(|slot| slot.is_none())
                        .ok_or(TemporalError::CapacityExceeded)?;
                    *empty = Some(EventResult {
                        event,
                        status: Status::Pending,
                    });
                    next.last_event = Some(event);
                }
            }
            Input::Predicate(observation) => {
                if observation.at_ms != time.now_ms {
                    return Err(TemporalError::InvalidIdentity);
                }
                if observation.value && observation.quality == EvidenceQuality::Measured {
                    for slot in next.slots.iter_mut().flatten() {
                        if slot.status == Status::Pending
                            && observation.at_ms >= slot.event.at_ms
                            && observation.at_ms < slot.event.at_ms + self.window_ms
                        {
                            slot.status = Status::Satisfied {
                                at_ms: observation.at_ms,
                            };
                        }
                    }
                }
            }
            Input::Acknowledge(key) => {
                let slot = next
                    .slots
                    .iter_mut()
                    .find(|slot| slot.is_some_and(|result| result.event.key == key))
                    .ok_or(TemporalError::InvalidIdentity)?;
                if slot.is_some_and(|result| result.status == Status::Pending) {
                    return Err(TemporalError::InvalidIdentity);
                }
                *slot = None;
            }
            Input::Clock => {}
        }
        Ok(())
    }

    pub fn commit(&mut self) -> Result<()> {
        self.committed = self.candidate.take().ok_or(TemporalError::NotStaged)?;
        Ok(())
    }

    pub fn rollback(&mut self) -> Result<()> {
        self.candidate.take().ok_or(TemporalError::NotStaged)?;
        Ok(())
    }
}
