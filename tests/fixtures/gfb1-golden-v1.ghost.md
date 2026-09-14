# GFB1 version 1 golden vector

This literate document is the authoritative source for the tracked GFB1 golden
artifact. The program is intentionally small and runs only in virtual host
conformance tests.

```ghost
(module gfb1_golden
  (version 1)
  (input enabled bool)
  (state running bool false)
  (strategy basic 0
    (device (has actuator pump bool))
    (next running input.enabled)
    (intent pump (not input.enabled))))
```
