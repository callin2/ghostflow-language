# Real-time keyboard host

The native `keyboard` example runs a compiled GFB with virtual terminal input.
It does not access GPIO, serial, MQTT, or a network device.

```sh
cargo run --locked --offline -p ghostflow-core --example keyboard -- \
  build/program.gfb \
  --key 1=start --key 2=stop \
  --record build/keyboard-events.csv
```

The terminal is placed in raw mode while the process runs and is restored on
normal exit. Press `Ctrl-C` to exit. A number `1` through `8` toggles the
matching input and produces one runtime tick.

The mapper holds one boolean state per configured input. Each press of a bound
number toggles that input between `true` and `false`. No keyup event is needed.
Unbound keys are ignored. Every press ticks the runtime with the complete
current boolean state.

`--record` writes replayable event records with this header:

```csv
logical_time_ms,key,event
```

The existing `run` CSV runner remains unchanged. The recorded event CSV is an
audit stream for a host adapter; it is not accepted as the ordinary input
matrix used by `run`.
