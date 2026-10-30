# Compiler correctness adversarial example

```ghost
import Cell from "./cell.ghost.md" revision "adversarial-v1" sha256 "84c09ecfb9e017ceead9356a1dc5d256a341850a3a737530f6985c569bd1587b";
control Pair { input left, right: Bool; output a, b: Int; instance east: Cell;
instance west: Cell;
connect east.enabled <- left;
connect west.enabled <- right;
connect a <- east.value;
connect b <- west.value; }
```
