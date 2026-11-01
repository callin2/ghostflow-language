<!-- translation-source: examples/authoring/pump-rev-1.ghost.md -->
[Original en inglés](pump-rev-1.ghost.md)
> Traducción de lectura. Para compilar, use el archivo original `.ghost.md` enlazado.

# Solicitud de bomba con permiso

Este archivo es la revisión `rev-1-input-v1` del documento `GF-EXAMPLE-PUMP`: un
candidato literate completo, verificado antes de cualquier corrección. El usuario
confirmó dos reglas: STOP tiene prioridad y, si falta el permiso, se bloquea la
intención segura de la bomba.

<!-- ghostflow:anchor id=GF-INT-PUMP-REQUEST kind=intent status=confirmed origin=user -->
> START solicita la bomba. STOP cancela la solicitud.

<!-- ghostflow:anchor id=GF-INT-PUMP-PERMIT kind=intent status=confirmed origin=user -->
> La bomba debe bloquearse cuando el permiso está ausente.

<!-- ghostflow:anchor id=GF-ASM-PUMP-MAX-RUN kind=assumption status=unconfirmed origin=ai -->
> Puede que se desee una duración máxima de funcionamiento. No se indicaron su valor ni la regla de rearranque. Consulte al usuario antes de agregar un temporizador.

Esta es una revisión de fuente explícita input-quality-v1: cada entrada lleva la calidad del productor (`ok` o `fault`). Una solicitud desconocida (en fallo) conserva el estado de solicitud almacenado y nunca puede crear una solicitud nueva. Un STOP conocido, o un START conocido y liberado, cancela la solicitud. Los bytes de la fuente original y la evidencia de benchmark fechada se conservan por separado. La asignación de `pump` que aparece abajo está incompleta a propósito (`pump <- start && ;`): `ghostc` la rechaza con un diagnóstico `GF_PARSE`, y la [revisión 2](pump-rev-2.ghost.es.md) la corrige.

```ghost
control PumpRequest {
  input start, stop, permit_ok: Bool;
  output pump, permit: Bool;
  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  state requested: Bool = false;
  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let start_value = case start { ok(value) => value; fault(_) => requested; };
  let stop_value = case stop { ok(value) => value; fault(_) => false; };
  requested' = if stop_good && stop_value then false
    else if start_good && !start_value then false
    else if start_good && stop_good then start_value && !stop_value
    else requested;

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=implements
  state permission: Bool = false;
  permission' = case permit_ok { ok(value) => value; fault(_) => permission; };

  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  pump <- start && ;
  permit <- permission';

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=constrains
  require pump => permit;
}
```
