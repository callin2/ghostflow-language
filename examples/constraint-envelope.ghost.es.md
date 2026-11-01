<!-- translation-source: examples/constraint-envelope.ghost.md -->
[Original en inglés](constraint-envelope.ghost.md)
> Traducción de lectura. Para compilar, use el archivo original `.ghost.md` enlazado.

# Una envolvente local completa de salidas

Este ejemplo, solo de software, contiene exactamente un control, sin importaciones
ni vinculaciones ocultas. El host de prueba suministra las cuatro entradas como
observaciones Bool. Las cuatro salidas son puntos finales virtuales de intención
Bool. Para estos puntos finales virtuales en particular, `false` es el valor
inactivo elegido explícitamente. Esa elección no convierte `false` en un
comportamiento seguro para recursos físicos arbitrarios.

La solicitud expresa un objetivo. Después, las reglas obligatorias locales limitan
qué salidas se permiten: la bomba necesita una válvula lista, y las dos salidas de
sentido no deben estar activas al mismo tiempo. Estas reglas no eligen una
política de arbitraje automático/manual, ni certifican que alguna salida haya
llegado al hardware.

Esta es la revisión explícita input-quality-v1. Cuando los datos del productor son desconocidos (un fallo), el ejemplo conserva su última observación de esa entrada. El `false` inicial solo inicializa esta memoria de observación local a la fuente. El documento original se conserva por separado.

```ghost
control OutputEnvelope {
  input observed_start, observed_valve_ready, observed_forward_request, observed_reverse_request: Bool;
  state remembered_start: Bool = false;
  let start = case observed_start { ok(value) => value; fault(_) => remembered_start; };
  remembered_start' = start;
  state remembered_valve_ready: Bool = false;
  let valve_ready = case observed_valve_ready { ok(value) => value; fault(_) => remembered_valve_ready; };
  remembered_valve_ready' = valve_ready;
  state remembered_forward_request: Bool = false;
  let forward_request = case observed_forward_request { ok(value) => value; fault(_) => remembered_forward_request; };
  remembered_forward_request' = forward_request;
  state remembered_reverse_request: Bool = false;
  let reverse_request = case observed_reverse_request { ok(value) => value; fault(_) => remembered_reverse_request; };
  remembered_reverse_request' = reverse_request;
  output pump, valve, forward, reverse: Bool;
  pump <- start;
  valve <- valve_ready;
  forward <- forward_request;
  reverse <- reverse_request;

  constraints LocalEnvelope {
    require at safe_output pump => valve;
    mutex(forward, reverse);
  }
}
```

El bloque `constraints LocalEnvelope` contiene dos reglas locales. En cada escaneo,
el control calcula primero las salidas *solicitadas* a partir de las entradas.
Después, las reglas las proyectan sobre las salidas *seguras* que el host recibe
realmente:

| Situación | Entradas | Salidas solicitadas | Salidas seguras | Regla que se aplica |
| --- | --- | --- | --- | --- |
| Válvula no lista | `start=true`, `valve_ready=false` | `pump=true`, `valve=false` | `pump=false`, `valve=false` | `require at safe_output pump => valve` |
| Válvula lista | `start=true`, `valve_ready=true` | `pump=true`, `valve=true` | `pump=true`, `valve=true` | Regla satisfecha; ahora se permite la misma solicitud |
| Ambos sentidos solicitados | `forward_request=true`, `reverse_request=true` | `forward=true`, `reverse=true` | `forward=false`, `reverse=false` | `mutex(forward, reverse)` |

Esto es solo una proyección local de salidas. No es control de admisión ni
aplicación genérica de recursos compartidos. El [contrato de restricciones](../docs/CONSTRAINTS.es.md)
describe esas etapas separadas y el límite explícito de vinculación.
