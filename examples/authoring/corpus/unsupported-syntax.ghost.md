# Unsupported timer shorthand

<!-- ghostflow:anchor id=GF-CORPUS-UNSUPPORTED-INTENT kind=intent status=confirmed origin=user -->
> Stop the pump after the requested delay.

```ghost
control UnsupportedTimer {
  input start: Bool;
  output pump: Bool;
  pump <- start after 2s;
}
```
