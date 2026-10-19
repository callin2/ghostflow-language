# Original E01 and E03 code before the explicit input-quality revision

Historical, non-executable evidence from book revision
`0e5b790babee4157c42d82ddb01f8eecb0c3f6e6`. The following code is copied exactly
from the English book's E01 and E03 fences before the approved #531 migration.
It establishes the original healthy-control oracle, not an acquisition-fault policy.
The current book contains a new explicit revision; this record is never a compiler fallback.

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
