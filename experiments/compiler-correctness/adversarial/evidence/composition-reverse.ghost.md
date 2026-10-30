# Compiler correctness adversarial example

```ghost
import Cell from "./cell.ghost.md" revision "adversarial-v1" sha256 "84c09ecfb9e017ceead9356a1dc5d256a341850a3a737530f6985c569bd1587b";
control Pair { input left, right: Bool; output a, b: Int; connect b <- west.value;
connect a <- east.value;
connect west.enabled <- right;
connect east.enabled <- left;
instance west: Cell;
instance east: Cell; }
```
