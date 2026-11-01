# Original E01 and E03 code before the explicit input-quality revision

This page is historical, non-executable evidence from book revision
`0e5b790babee4157c42d82ddb01f8eecb0c3f6e6`. The code below is copied exactly
from the English book's E01 and E03 fences, as they were before the approved
#531 migration.

It records the original healthy-control oracle (the expected behavior when
inputs are healthy). It does not define an acquisition-fault policy. The
current book contains a new, explicit revision of these examples, and this
record is never used as a compiler fallback.

## E01

```text
// E01
control FollowSwitch {
  input switch_on: Bool;
  output lamp: Bool;

  lamp <- switch_on;
}
```

## E03

```text
// E03
control LatchingPump {
  input start, stop: Bool;
  state running: Bool = false;
  output valve, pump: Bool;

  running' = !stop && (start || running);
  valve <- running';
  pump <- running';

  require pump => valve;
}
```
