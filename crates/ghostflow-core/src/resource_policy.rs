//! Bounded resource-policy admission for host supplied resource bindings.
//!
//! The compiler publishes the policy contract. This module owns the small,
//! deterministic runtime state needed to reserve a lease and its finite
//! budget in one admission decision. GPIO and driver application remain above
//! this boundary.

use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueuePolicy {
    Reject,
    Fifo { max: usize, expires_after_ms: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourcePolicyConfig {
    pub concurrency: usize,
    pub queue: QueuePolicy,
}

impl ResourcePolicyConfig {
    pub fn validate(self) -> Result<(), PolicyError> {
        if self.concurrency == 0 {
            return Err(PolicyError::InvalidConfig("concurrency must be positive"));
        }
        if let QueuePolicy::Fifo {
            max,
            expires_after_ms,
        } = self.queue
        {
            if max == 0 {
                return Err(PolicyError::InvalidConfig("queue max must be positive"));
            }
            if expires_after_ms == 0 {
                return Err(PolicyError::InvalidConfig("queue expiry must be positive"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceRequest {
    pub request_id: u64,
    pub owner_id: u64,
    pub budget_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LeaseGrant {
    pub request_id: u64,
    pub owner_id: u64,
    pub deadline_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    Granted(LeaseGrant),
    Queued,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyError {
    InvalidConfig(&'static str),
    InvalidRequest(&'static str),
    DuplicateRequest,
    QueueFull,
    Rejected,
    Overflow,
    UnknownLease,
}

impl std::fmt::Display for PolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        use PolicyError::*;
        f.write_str(match self {
            InvalidConfig(message) | InvalidRequest(message) => message,
            DuplicateRequest => "request id is already present",
            QueueFull => "resource policy queue is full",
            Rejected => "resource policy rejected request",
            Overflow => "resource policy deadline overflowed",
            UnknownLease => "resource lease is unknown",
        })
    }
}

impl std::error::Error for PolicyError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct QueuedRequest {
    request: ResourceRequest,
    enqueued_at_ms: u64,
}

/// Deterministic, bounded admission state for one physical resource.
#[derive(Debug)]
pub struct ResourcePolicy {
    config: ResourcePolicyConfig,
    active: Vec<LeaseGrant>,
    queued: VecDeque<QueuedRequest>,
}

impl ResourcePolicy {
    pub fn new(config: ResourcePolicyConfig) -> Result<Self, PolicyError> {
        config.validate()?;
        Ok(Self {
            config,
            active: Vec::with_capacity(config.concurrency),
            queued: VecDeque::new(),
        })
    }

    pub fn active(&self) -> &[LeaseGrant] {
        &self.active
    }
    pub fn queued_len(&self) -> usize {
        self.queued.len()
    }

    /// Atomically reserves a slot and the request's finite budget.
    pub fn admit(
        &mut self,
        now_ms: u64,
        request: ResourceRequest,
    ) -> Result<Admission, PolicyError> {
        self.expire_queued(now_ms);
        self.validate_request(request)?;
        if self.contains(request.request_id) {
            return Err(PolicyError::DuplicateRequest);
        }
        if self.active.len() < self.config.concurrency {
            let grant = self.grant(now_ms, request)?;
            self.active.push(grant);
            return Ok(Admission::Granted(grant));
        }
        match self.config.queue {
            QueuePolicy::Reject => Err(PolicyError::Rejected),
            QueuePolicy::Fifo { max, .. } if self.queued.len() >= max => {
                Err(PolicyError::QueueFull)
            }
            QueuePolicy::Fifo { .. } => {
                self.queued.push_back(QueuedRequest {
                    request,
                    enqueued_at_ms: now_ms,
                });
                Ok(Admission::Queued)
            }
        }
    }

    /// Releases a lease and promotes the oldest unexpired queued request.
    pub fn release(
        &mut self,
        now_ms: u64,
        request_id: u64,
    ) -> Result<Option<LeaseGrant>, PolicyError> {
        let Some(index) = self
            .active
            .iter()
            .position(|grant| grant.request_id == request_id)
        else {
            return Err(PolicyError::UnknownLease);
        };
        self.active.swap_remove(index);
        self.expire_queued(now_ms);
        let Some(waiting) = self.queued.pop_front() else {
            return Ok(None);
        };
        let grant = self.grant(now_ms, waiting.request)?;
        self.active.push(grant);
        Ok(Some(grant))
    }

    /// Removes queued requests whose bounded wait has elapsed.
    pub fn expire_queued(&mut self, now_ms: u64) {
        let QueuePolicy::Fifo {
            expires_after_ms, ..
        } = self.config.queue
        else {
            return;
        };
        self.queued
            .retain(|entry| now_ms.saturating_sub(entry.enqueued_at_ms) < expires_after_ms);
    }

    fn validate_request(&self, request: ResourceRequest) -> Result<(), PolicyError> {
        if request.request_id == 0 || request.owner_id == 0 || request.budget_ms == 0 {
            return Err(PolicyError::InvalidRequest(
                "request, owner, and budget must be non-zero",
            ));
        }
        Ok(())
    }

    fn contains(&self, request_id: u64) -> bool {
        self.active
            .iter()
            .any(|grant| grant.request_id == request_id)
            || self
                .queued
                .iter()
                .any(|entry| entry.request.request_id == request_id)
    }

    fn grant(&self, now_ms: u64, request: ResourceRequest) -> Result<LeaseGrant, PolicyError> {
        Ok(LeaseGrant {
            request_id: request.request_id,
            owner_id: request.owner_id,
            deadline_ms: now_ms
                .checked_add(request.budget_ms)
                .ok_or(PolicyError::Overflow)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(queue: QueuePolicy) -> ResourcePolicy {
        ResourcePolicy::new(ResourcePolicyConfig {
            concurrency: 1,
            queue,
        })
        .unwrap()
    }
    fn request(id: u64) -> ResourceRequest {
        ResourceRequest {
            request_id: id,
            owner_id: 9,
            budget_ms: 100,
        }
    }

    #[test]
    fn reserves_lease_and_budget_in_one_grant() {
        let mut resource = policy(QueuePolicy::Reject);
        assert_eq!(
            resource.admit(50, request(1)),
            Ok(Admission::Granted(LeaseGrant {
                request_id: 1,
                owner_id: 9,
                deadline_ms: 150
            }))
        );
        assert_eq!(resource.active().len(), 1);
    }

    #[test]
    fn bounded_fifo_promotes_oldest_and_expires_waiters() {
        let mut resource = policy(QueuePolicy::Fifo {
            max: 2,
            expires_after_ms: 10,
        });
        assert!(matches!(
            resource.admit(0, request(1)),
            Ok(Admission::Granted(_))
        ));
        assert_eq!(resource.admit(1, request(2)), Ok(Admission::Queued));
        assert_eq!(resource.admit(2, request(3)), Ok(Admission::Queued));
        assert_eq!(resource.release(5, 1).unwrap().unwrap().request_id, 2);
        assert_eq!(resource.release(20, 2), Ok(None));
        assert_eq!(resource.queued_len(), 0);
    }

    #[test]
    fn reject_policy_and_duplicate_ids_fail_closed() {
        let mut resource = policy(QueuePolicy::Reject);
        resource.admit(0, request(1)).unwrap();
        assert_eq!(
            resource.admit(1, request(1)),
            Err(PolicyError::DuplicateRequest)
        );
        assert_eq!(resource.admit(1, request(2)), Err(PolicyError::Rejected));
        assert_eq!(resource.release(1, 99), Err(PolicyError::UnknownLease));
    }

    #[test]
    fn invalid_and_overflowing_requests_are_rejected() {
        let mut resource = policy(QueuePolicy::Reject);
        assert_eq!(
            resource.admit(
                0,
                ResourceRequest {
                    request_id: 1,
                    owner_id: 1,
                    budget_ms: 0
                }
            ),
            Err(PolicyError::InvalidRequest(
                "request, owner, and budget must be non-zero"
            ))
        );
        assert_eq!(
            resource.admit(u64::MAX, request(1)),
            Err(PolicyError::Overflow)
        );
    }
}
