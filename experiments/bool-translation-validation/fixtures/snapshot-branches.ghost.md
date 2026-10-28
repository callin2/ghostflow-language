# Bool snapshot and branch proof input

This proof fixture keeps old and candidate state reads distinct, swaps two states,
retains an undefined next state, and exercises nested Boolean branches.

```ghost
control BoolSnapshotBranches {
  state left: Bool = true;
  state right: Bool = false;
  state retained: Bool = true;
  left' = right;
  right' = left;
  output old: Bool;
  output candidate: Bool;
  output nested: Bool;
  output held: Bool;
  old <- left;
  candidate <- left';
  nested <- if !left then right' || retained else left' && !right;
  held <- retained';
}
```
