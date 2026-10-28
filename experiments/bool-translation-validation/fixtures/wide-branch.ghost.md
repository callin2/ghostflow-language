# Bool branch with a nonzero high offset byte

This canonical fixture makes the outer true block exceed 255 bytes, so the
serializer and raw-byte recovery checks exercise both little-endian bytes.

```ghost
control BoolWideBranch {
  state left: Bool = true;
  state right: Bool = false;
  output wide: Bool;
  wide <- if left then (((((left && left) && !(left && left)) && ((left && left) && !(left && left))) && !(((left && left) && !(left && left)) && ((left && left) && !(left && left)))) && ((((left && left) && !(left && left)) && ((left && left) && !(left && left))) && !(((left && left) && !(left && left)) && ((left && left) && !(left && left))))) else right;
}
```
