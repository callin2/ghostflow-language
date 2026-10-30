# BridgeChained

```ghost
control BridgeChained {
  input raw_a: Bool;
  input raw_b: Bool;
  input raw_c: Bool;
  input raw_d: Bool;
  input raw_e: Bool;
  input raw_f: Bool;
  state remembered: Bool = false;
  remembered' = case raw_a { ok(value) => value; fault(_) => remembered; };
  output a, b, c, d, e, f: Bool;
  a <- remembered';
  b <- case raw_b { ok(value) => value; fault(_) => false; };
  c <- case raw_c { ok(value) => value; fault(_) => false; };
  d <- case raw_d { ok(value) => value; fault(_) => false; };
  e <- case raw_e { ok(value) => value; fault(_) => false; };
  f <- case raw_f { ok(value) => value; fault(_) => false; };
  require a => b;
  require a => b;
  require a => b || c;
  require a => b || c;
  mutex(d, e, f);
  mutex(d, e, f);
  require b => d;
  require b => d;
  require d => e;
  require d => e;
}
```
