# Read-only settings producer

This setting has no live operator authority. Its producer can still report an
unavailable observation and later recover with a typed success.

```ghost
control ReadonlySettings {
  config duration_limit: Duration = 5min;
  output available: Bool;
  available <- case duration_limit {
    ok(_) => true;
    fault(_) => false;
  };
}
```
