# GFB1 version 1 golden vector

This literate document is the authoritative source for the tracked GFB1 golden
artifact. The program is intentionally small and runs only in virtual host
conformance tests.

```ghost
control gfb1_golden {
  input enabled: Bool;
  state running: Bool = false;
  running' = enabled;
  output pump: Bool;
  pump <- !enabled;
}
```
