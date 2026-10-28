# Bool literal proof input

This proof fixture exercises the branch-free GFB profile.

```ghost
control BoolLiterals {
  state flag: Bool = false;
  flag' = !flag;
  output inverted: Bool;
  output always: Bool;
  output never: Bool;
  inverted <- !flag';
  always <- true;
  never <- false;
}
```
