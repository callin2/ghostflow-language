# BridgeNineFallback

```ghost
control BridgeNineFallback {
  input raw_a: Bool;
  input raw_b: Bool;
  input raw_c: Bool;
  input raw_d: Bool;
  input raw_e: Bool;
  input raw_f: Bool;
  input raw_g: Bool;
  input raw_h: Bool;
  input raw_i: Bool;

  output a, b, c, d, e, f, g, h, i: Bool;
  a <- case raw_a { ok(value) => value; fault(_) => false; };
  b <- case raw_b { ok(value) => value; fault(_) => false; };
  c <- case raw_c { ok(value) => value; fault(_) => false; };
  d <- case raw_d { ok(value) => value; fault(_) => false; };
  e <- case raw_e { ok(value) => value; fault(_) => false; };
  f <- case raw_f { ok(value) => value; fault(_) => false; };
  g <- case raw_g { ok(value) => value; fault(_) => false; };
  h <- case raw_h { ok(value) => value; fault(_) => false; };
  i <- case raw_i { ok(value) => value; fault(_) => false; };
  mutex(a, b, c, d, e, f, g, h, i);
  mutex(a, b, c, d, e, f, g, h, i);
}
```
