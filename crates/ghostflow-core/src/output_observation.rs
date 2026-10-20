//! Trusted renderer observations, distinct from requested/safe output intent.
//! An observation is scoped to one execution, logical output and request.
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum OutputStatus {
    Initial = 0,
    Pending = 1,
    Completed = 2,
    Failed = 3,
    Unknown = 4,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum OutputHealth {
    Initializing = 0,
    Healthy = 1,
    Faulted = 2,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum OutputCompletion {
    None = 0,
    HostWrite = 1,
    DeviceAck = 2,
    DeviceReadback = 3,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum OutputFault {
    None = 0,
    Unavailable = 1,
    Timeout = 2,
    ProtocolError = 3,
    DriverError = 4,
    ObservationLost = 5,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputObservation {
    pub run_id: String,
    pub output: String,
    pub request_id: u64,
    pub status: OutputStatus,
    pub health: OutputHealth,
    pub completion: OutputCompletion,
    pub fault: OutputFault,
}

impl OutputObservation {
    pub fn initial(run_id: &str, output: &str) -> Self {
        Self {
            run_id: run_id.into(),
            output: output.into(),
            request_id: 0,
            status: OutputStatus::Initial,
            health: OutputHealth::Initializing,
            completion: OutputCompletion::None,
            fault: OutputFault::None,
        }
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        use OutputStatus::*;
        if (self.health == OutputHealth::Faulted) != (self.fault != OutputFault::None) {
            return Err("inconsistent output health and fault");
        }
        let valid = match self.status {
            Initial => self.request_id == 0 && self.completion == OutputCompletion::None,
            Pending => self.request_id > 0 && self.completion == OutputCompletion::None,
            Completed => self.request_id > 0 && self.completion != OutputCompletion::None,
            Failed | Unknown => {
                self.health == OutputHealth::Faulted && self.fault != OutputFault::None
            }
        };
        if valid {
            Ok(())
        } else {
            Err("inconsistent output observation")
        }
    }
    /// Numeric rails retain the existing scalar GFB encoding.
    pub fn rails(&self) -> [f64; 4] {
        [
            self.status as u8 as f64,
            self.health as u8 as f64,
            self.completion as u8 as f64,
            self.fault as u8 as f64,
        ]
    }
}

#[derive(Clone, Debug)]
pub struct OutputObservationTracker {
    run_id: String,
    observations: BTreeMap<String, OutputObservation>,
}

impl OutputObservationTracker {
    pub fn new(run_id: &str, outputs: &[&str]) -> Result<Self, &'static str> {
        if run_id.is_empty() || run_id.len() > 128 || outputs.is_empty() || outputs.len() > 32 {
            return Err("invalid output observation identity or bound");
        }
        let mut observations = BTreeMap::new();
        for output in outputs {
            if output.is_empty()
                || output.len() > 96
                || output.starts_with("__gf_")
                || !output.bytes().enumerate().all(|(i, c)| {
                    c == b'_' || c.is_ascii_alphabetic() || i > 0 && c.is_ascii_digit()
                })
                || observations
                    .insert((*output).into(), OutputObservation::initial(run_id, output))
                    .is_some()
            {
                return Err("invalid or duplicate output identity");
            }
        }
        Ok(Self {
            run_id: run_id.into(),
            observations,
        })
    }
    pub fn observation(&self, output: &str) -> Result<&OutputObservation, &'static str> {
        self.observations.get(output).ok_or("unknown output")
    }
    /// Called only when the host really dispatches a new renderer request.
    pub fn begin_request(
        &mut self,
        run_id: &str,
        output: &str,
        request_id: u64,
    ) -> Result<(), &'static str> {
        if run_id != self.run_id {
            return Err("stale output run");
        }
        let current = self.observations.get_mut(output).ok_or("unknown output")?;
        if request_id == 0 || request_id <= current.request_id {
            return Err("stale output request");
        }
        *current = OutputObservation {
            run_id: run_id.into(),
            output: output.into(),
            request_id,
            status: OutputStatus::Pending,
            health: current.health,
            completion: OutputCompletion::None,
            fault: current.fault,
        };
        Ok(())
    }
    /// Accept evidence only for the currently dispatched request. Pending is not a fault.
    pub fn observe(&mut self, observation: OutputObservation) -> Result<(), &'static str> {
        observation.validate()?;
        if observation.run_id != self.run_id {
            return Err("stale output run");
        }
        let current = self
            .observations
            .get_mut(&observation.output)
            .ok_or("unknown output")?;
        if observation.request_id != current.request_id {
            return Err("stale output request");
        }
        if observation.completion < current.completion
            || current.status != OutputStatus::Initial
                && observation.status == OutputStatus::Initial
            || matches!(
                current.status,
                OutputStatus::Completed | OutputStatus::Failed | OutputStatus::Unknown
            ) && observation.status != current.status
        {
            return Err("output observation regressed");
        }
        *current = observation;
        Ok(())
    }
    /// A fresh execution discards all old request identities and evidence.
    pub fn reset_run(&mut self, run_id: &str) -> Result<(), &'static str> {
        if run_id.is_empty() || run_id.len() > 128 || run_id == self.run_id {
            return Err("reset requires a fresh run identity");
        }
        self.run_id = run_id.into();
        for (output, observation) in &mut self.observations {
            *observation = OutputObservation::initial(run_id, output);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_completion_fault_independence_and_identity() {
        let mut tracker = OutputObservationTracker::new("run1", &["pump", "valve"]).unwrap();
        assert_eq!(
            tracker.observation("pump").unwrap().rails(),
            [0., 0., 0., 0.]
        );
        tracker.begin_request("run1", "pump", 1).unwrap();
        let mut observation = tracker.observation("pump").unwrap().clone();
        assert_eq!(observation.fault, OutputFault::None);
        observation.status = OutputStatus::Completed;
        observation.health = OutputHealth::Healthy;
        observation.completion = OutputCompletion::HostWrite;
        tracker.observe(observation.clone()).unwrap();
        assert_eq!(
            tracker.observation("valve").unwrap().status,
            OutputStatus::Initial
        );
        tracker.begin_request("run1", "pump", 2).unwrap();
        assert_eq!(tracker.observe(observation), Err("stale output request"));
        let mut failure = tracker.observation("pump").unwrap().clone();
        failure.status = OutputStatus::Failed;
        failure.health = OutputHealth::Faulted;
        failure.fault = OutputFault::Timeout;
        tracker.observe(failure.clone()).unwrap();
        tracker.reset_run("run2").unwrap();
        assert_eq!(tracker.observe(failure), Err("stale output run"));
        assert_eq!(
            tracker.observation("pump").unwrap().status,
            OutputStatus::Initial
        );
    }
    #[test]
    fn inconsistent_or_unbound_evidence_is_rejected() {
        let mut tracker = OutputObservationTracker::new("run", &["pump"]).unwrap();
        tracker.begin_request("run", "pump", 1).unwrap();
        let mut observation = tracker.observation("pump").unwrap().clone();
        observation.status = OutputStatus::Completed;
        assert_eq!(
            tracker.observe(observation),
            Err("inconsistent output observation")
        );
        assert!(tracker.begin_request("run", "other", 1).is_err());
        assert!(tracker.reset_run("run").is_err());
    }
    #[test]
    fn initialization_health_and_pending_request_lifecycle_are_independent() {
        let mut tracker = OutputObservationTracker::new("run", &["pump"]).unwrap();
        let mut ready = tracker.observation("pump").unwrap().clone();
        ready.health = OutputHealth::Healthy;
        tracker.observe(ready).unwrap();
        tracker.begin_request("run", "pump", 1).unwrap();
        assert_eq!(
            tracker.observation("pump").unwrap().health,
            OutputHealth::Healthy
        );
        let mut failure = tracker.observation("pump").unwrap().clone();
        failure.status = OutputStatus::Failed;
        failure.health = OutputHealth::Faulted;
        failure.fault = OutputFault::Unavailable;
        tracker.observe(failure).unwrap();
        tracker.begin_request("run", "pump", 2).unwrap();
        let pending = tracker.observation("pump").unwrap();
        assert_eq!(pending.status, OutputStatus::Pending);
        assert_eq!(pending.health, OutputHealth::Faulted);
        assert_eq!(pending.fault, OutputFault::Unavailable);
    }
}
