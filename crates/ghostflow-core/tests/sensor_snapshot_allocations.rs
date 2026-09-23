use ghostflow_core::signals::{Filter, Sample, Sensor, SensorConfig};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

thread_local! {
    static TRACK: Cell<bool> = const { Cell::new(false) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

struct CountingAllocator;
fn record_allocation() {
    let _ = TRACK.try_with(|track| {
        if track.get() {
            ALLOCATIONS.with(|count| count.set(count.get() + 1));
        }
    });
}
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        record_allocation();
        System.alloc(layout)
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        record_allocation();
        System.realloc(pointer, layout, size)
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        System.dealloc(pointer, layout);
    }
}
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[test]
fn conditioning_and_snapshot_restore_allocate_no_heap_per_sample() {
    for filter in [
        Filter::Median(31),
        Filter::MovingAverage(31),
        Filter::Ema(0.5),
    ] {
        let mut sensor = Sensor::new(
            SensorConfig::new(filter, 0.0, 100.0, 1000, 2).with_hysteresis(30.0, 40.0, false),
        )
        .unwrap();
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));
        for id in 0..200 {
            let checkpoint = sensor.clone();
            let _ = sensor.update(Sample::good(1, id, id, (id % 100) as f64), id);
            let _ = sensor.read(id);
            let _ = sensor.read_hysteresis(id);
            if id % 3 == 0 {
                sensor = checkpoint;
            }
        }
        TRACK.with(|track| track.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0, "{filter:?}");
    }
}
