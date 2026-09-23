use ghostflow_core::{
    temporal::{RootDensity, TargetBudget},
    temporal_runtime::TemporalActivation,
};
use std::collections::BTreeSet;

pub fn parse_temporal(values: &[String]) -> Option<TemporalActivation> {
    let [epoch, samples, bytes, roots] = values else {
        return None;
    };
    let time_epoch = epoch.parse().ok()?;
    let max_retained_samples = samples.parse().ok()?;
    let max_bytes = bytes.parse().ok()?;
    if roots.is_empty() {
        return None;
    }
    let mut tags = BTreeSet::new();
    let mut root_density = Vec::new();
    for root in roots.split(',') {
        let fields: Vec<_> = root.split(':').collect();
        let [tag, observations, interval] = fields.as_slice() else {
            return None;
        };
        let source_tag = tag.parse().ok()?;
        if !tags.insert(source_tag) {
            return None;
        }
        root_density.push(RootDensity {
            source_tag,
            max_observations: observations.parse().ok()?,
            interval_ms: interval.parse().ok()?,
        });
    }
    Some(TemporalActivation {
        root_density,
        budget: TargetBudget {
            max_retained_samples,
            max_bytes,
        },
        time_epoch,
    })
}
