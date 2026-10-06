# Preserve the executed Boolean proof path

<!-- ghostflow:anchor id=GF-INT-REF-05-023 kind=intent status=confirmed origin=user -->
The false gate explains the requested OFF output. A skipped division must not
execute, fault, or become evidence. This is Language issue283, not full issue88.

```ghost
control ExplanationShortCircuit {
  // ghostflow:link id=GF-INT-REF-05-023 relation=implements
  state gate: Bool = false;
  // ghostflow:link id=GF-INT-REF-05-023 relation=implements
  state divisor: Number = 0.0;
  gate' = true;
  output pump: Bool;
  // ghostflow:link id=GF-INT-REF-05-023 relation=implements
  pump <- gate && (1.0 / divisor > 0.0);
}
```
