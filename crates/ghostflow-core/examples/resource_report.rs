//! Host layout measurements, not ESP32 RAM/WCET claims.
use ghostflow_core::{signals, station, Runtime};
fn main() {
    println!(
        "{{\"targetArch\":\"{}\",\"pointerBytes\":{},\"sensorInlineBytes\":{},\"stationHeaderBytesExcludingHeap\":{},\"runtimeHeaderBytesExcludingHeap\":{},\"maxSensorWindow\":{},\"maxSensorDiagnostics\":{},\"medianWorstCaseComparisons\":{},\"medianScratchBytes\":{},\"esp32Measured\":false}}",
        std::env::consts::ARCH,
        std::mem::size_of::<usize>(),
        std::mem::size_of::<signals::Sensor>(),
        std::mem::size_of::<station::Station>(),
        std::mem::size_of::<Runtime>(),
        signals::MAX_WINDOW,
        signals::MAX_DIAGNOSTICS,
        signals::MEDIAN_COST.comparisons,
        signals::MEDIAN_COST.scratch_values * std::mem::size_of::<f64>(),
    );
}
