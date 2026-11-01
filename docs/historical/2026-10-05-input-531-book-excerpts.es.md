<!-- translation-source: docs/historical/2026-10-05-input-531-book-excerpts.md -->
[Original en inglés](2026-10-05-input-531-book-excerpts.md)

# Código original de E01 y E03 antes de la revisión explícita de calidad de entrada

Esta página es evidencia histórica, no ejecutable, de la revisión del libro
`0e5b790babee4157c42d82ddb01f8eecb0c3f6e6`. El código siguiente está copiado
exactamente de los bloques delimitados E01 y E03 del libro en inglés, tal como
estaban antes de la migración aprobada de #531.

Registra el oráculo original de control sano (el comportamiento esperado cuando
las entradas están en buen estado). No define una política de fallos de
adquisición. El libro actual contiene una revisión nueva y explícita de estos
ejemplos, y este registro nunca se usa como respaldo (fallback) del compilador.

## E01

```text
// E01
control FollowSwitch {
  input switch_on: Bool;
  output lamp: Bool;

  lamp <- switch_on;
}
```

## E03

```text
// E03
control LatchingPump {
  input start, stop: Bool;
  state running: Bool = false;
  output valve, pump: Bool;

  running' = !stop && (start || running);
  valve <- running';
  pump <- running';

  require pump => valve;
}
```
