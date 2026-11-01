<!-- translation-source: docs/2026-09-24-authoring-baseline-provenance.md -->
[Original en inglés](2026-09-24-authoring-baseline-provenance.md)

# Procedencia de la línea base de autoría

Este registro explica por qué la prueba de eficiencia de autoría fallaba ante
ediciones ordinarias del núcleo en Rust, y el contrato permanente que la
reemplazó. Aquí, "procedencia" (provenance) significa la identidad de los
archivos fuente (herramientas, lockfile, Reference, núcleo en Rust) con los que
se midió un benchmark.

## Fallo

La prueba de eficiencia de autoría mezclaba dos tipos distintos de registro:

1. mediciones de un benchmark revisado y fechado; y
2. hashes calculados a partir del compilador y del núcleo en Rust que están
   actualmente en el checkout.

Además, la prueba exigía que todo el informe en vivo fuera igual al JSON
histórico. También fijaba el hash agregado en vivo en el código de la prueba.
Como resultado, cualquier edición legítima del núcleo en Rust hacía fallar la
CI, aunque todas las compilaciones, correcciones, diagnósticos, límites de
recuperación, resultados de simulación y mediciones de tokens siguieran iguales.
Reemplazar el hash antiguo por el nuevo hacía pasar la CI una vez, pero dejaba
en vigor el contrato defectuoso.

## Contrato permanente

La corrección separa la instantánea histórica congelada de la procedencia en
vivo:

| Registro | Fuente | Cómo se compara |
| --- | --- | --- |
| Identidad de fuente histórica en el JSON fechado | Revisada en `c7233b1` | Debe reproducir su digest almacenado y coincidir con un digest fijado de forma independiente |
| Procedencia en vivo | Derivada de los archivos del checkout en cada ejecución | Solo se informa; no necesita ser igual a la instantánea |
| Evidencia del benchmark (todo lo que está fuera de `sourceRevision`) | JSON fechado | Comparación exacta |

Las reglas en detalle:

- El JSON fechado heredado conserva la identidad de fuente revisada de
  `c7233b1`, cuyo digest agregado es
  `45f4efc0e2a8c7d227d04622ed4dc61ee63430646fd0751dd4e332fd35f5323f`.
- Su identidad de fuente almacenada debe reproducir su digest almacenado.
  También debe coincidir con ese digest revisado fijado de forma independiente.
  Se rechaza editar un campo de identidad y luego recalcular el digest
  almacenado.
- Cada ejecución de la prueba deriva las identidades actuales de la herramienta,
  el lockfile, el ejecutor de escenarios, la Reference y el núcleo en Rust a
  partir de los archivos del checkout. Esta procedencia en vivo se informa, pero
  no se exige que sea igual a la instantánea histórica.
- Toda la evidencia del benchmark fuera de `sourceRevision` se sigue
  comparando de forma exacta: casos, identidades de fuente, digests de secciones
  y límites de bytes, diagnósticos, rondas de corrección y de simulación,
  intenciones virtuales seguras, totales y datos de tokens.
- Un benchmark nuevo y deliberado es un nuevo artefacto fechado. El trabajo
  rutinario sobre la fuente nunca reescribe un benchmark histórico existente.

La prueba de regresión específica usa un árbol de fuentes temporal real. Esta
prueba:

- fija los digests esperados del árbol y del agregado;
- demuestra que cambiar la identidad del núcleo o la identidad de toda la
  Reference cambia la procedencia en vivo sin cambiar el benchmark;
- rechaza archivos declarados que falten;
- rechaza la manipulación de la identidad almacenada, incluso cuando se
  recalcula su digest; y
- rechaza mediciones de benchmark modificadas.

Los digests exactos y los recuentos de bytes de cada sección de la Reference
que consultó el benchmark siguen formando parte de la comparación.
