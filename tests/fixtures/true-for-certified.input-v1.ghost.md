# Certified hot interval

The alarm requires five minutes of continuous hot observations certified by the
bound Driver. Point readings and elapsed scan time cannot establish continuity.
Unavailable evidence produces the explicit false recovery value.

```ghost
control TrueForCertified {
  input hot: Bool;
  signal sustained = true_for(hot, duration: 5min, quality: measured);
  output alarm: Bool;
  alarm <- sustained |> recover(false);
}
```
