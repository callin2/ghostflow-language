# Irrigation runtime fixture

This canonical literate fixture supplies the portable-core host tests. It is a
virtual control fixture, not hardware or deployment evidence.

```ghost
control irrigation {
  input start, stop, low_water: Bool;
  input moisture: Number;
  state watering: Bool = false;
  state low_fault: Bool = false;
  output pump, valve: Bool;

  low_fault' = low_water;
  watering' = if stop || low_water then false else start || watering;
  pump <- watering';
  valve <- watering';
}
```
