<!-- translation-source: tasks/temporal-policy-decisions.md -->
[Original en inglés](temporal-policy-decisions.md)

# Decisiones de política temporal

**Estado: decisiones de producto aprobadas, registradas en la Referencia §§3.5 y
4.4.**

Este archivo sigue siendo un registro de planificación para pruebas y contratos
técnicos. No afirma que el compilador o el runtime lo soporten.

**En este documento:**

| Tema | Decisión en una línea | Referencia |
| --- | --- | --- |
| `true_for` | Solo cuentan los intervalos continuos certificados por el Driver; sin interpolación. | §4.4 |
| `after_event` | Cada evento de inicio conserva su propio resultado independiente. | §4.4 |
| Cruces múltiples de una programación | Todas las ocurrencias cruzadas se omiten; no se ejecuta ninguna. | §3.5 |

Cada decisión siguiente cita la oración en coreano que se aplicó a la
Referencia.

## Decisiones tomadas

### `true_for`

`true_for(..., quality: measured)` solo puede acumular intervalos continuos que
el Driver instalado certifica como realmente observados. Las muestras puntuales
separadas no certifican el intervalo entre ellas.

El compilador/runtime no debe:

- interpolar entre muestras; ni
- tratar la cadencia esperada, la cadencia de escaneo, las muestras duplicadas
  o los ticks solo de reloj como continuidad observada.

Aplicado a la Referencia §4.4 después de la oración existente sobre `true_for`:

> 연속성은 Driver가 실제 관측되었다고 인증한 interval만 이어 붙인다. 서로 떨어진
> sample 사이를 보간하거나 expected cadence, scan cadence, duplicate, clock-only tick을
> 관측 증거로 간주하지 않는다.

### `after_event`

Cada evento de inicio distinto tiene un resultado rastreado de forma
independiente.

- Los eventos que se solapan siguen siendo distinguibles.
- Un evento de inicio posterior no sobrescribe un resultado anterior pendiente
  o completado.
- El intervalo semiabierto existente `[e,e+window)` sigue aplicándose a cada
  identidad de evento.

Aplicado a la Referencia §4.4 después de la oración existente sobre
`after_event`:

> 겹치는 event도 identity별 result를 독립적으로 유지한다. 새 start event는 이전
> pending 또는 completed result를 덮어쓰지 않는다.

Esto resuelve la elección de producto que antes figuraba como pendiente en
`tasks/after-event-design.md`: seleccionar resultados independientes por
evento.

### Cruces múltiples de una programación

Cuando un intervalo de observación aceptado cruza dos o más ocurrencias de la
misma programación, registre cada ocurrencia cruzada como omitida y no ejecute
ninguna.

Esta regla se aplica solo al caso de cruces múltiples. Un escaneo que cruza
exactamente una ocurrencia sigue usando las reglas ordinarias de admisión de
pulse.

Aplicado a la Referencia §3.5, en la parte de brechas de observación y
recuperación:

> 하나의 accepted observation interval에서 같은 schedule의 occurrence를 둘 이상
> 교차하면 교차한 occurrence를 모두 missed로 기록하고 어느 것도 실행하지 않는다.
> 정확히 하나만 교차한 경우에는 ordinary admission 규칙을 그대로 적용한다.

## Escenarios decisivos de la especificación

Cada escenario separa el comportamiento aprobado de uno erróneo plausible.

1. **Continuidad certificada:** dos intervalos verdaderos contiguos certificados
   por el Driver cuya unión alcanza la duración positiva hacen que `true_for`
   sea verdadero en el límite.
2. **Sin interpolación:** muestras puntuales verdaderas en `t=0` y `t=d` sin un
   intervalo certificado entre ellas no satisfacen `true_for`, sin importar la
   cadencia de escaneo esperada o real.
3. **Ruptura de continuidad:** una brecha en la cobertura certificada, un
   intervalo falso o una calidad inadmisible reinician el intervalo verdadero
   acumulado.
4. **Eventos solapados:** empieza el evento `A` y luego empieza el evento `B`
   antes de que termine la ventana de `A`. Las observaciones del predicado
   actualizan los resultados de `A` y `B`, direccionables por separado; `B`
   nunca reemplaza a `A`.
5. **Límite semiabierto del evento:** la evidencia exactamente en `e + window`
   se excluye solo del resultado de ese evento y no puede borrar otro resultado
   solapado.
6. **Cruces Solar múltiples:** con `gap = skip_after(3days)`, un intervalo
   aceptado que contiene dos ocurrencias Solar registra ambas como omitidas, no
   produce ejecución para ninguna, y un reintento idéntico no puede duplicar los
   dos registros tras la consolidación (commit).
7. **Control de un solo cruce:** la misma programación con una sola ocurrencia
   cruzada sigue el comportamiento ordinario de predicado/admisión. Esto
   demuestra que la nueva política de omisión no se aplicó de forma general.

## Contratos técnicos aún requeridos

Estas decisiones **no** eligen los siguientes contratos de implementación:

- La forma en el wire de los certificados de intervalo del Driver, la
  vinculación de confianza, la validación de cobertura, la identidad de
  reloj/época y la propagación de pruebas a través de señales transformadas.
- El estado acotado, los puntos de control, la reproducción y la
  contabilización de recursos para intervalos certificados.
- La ABI de entrada de eventos, la vinculación de identidad opaca, la
  proyección de resultados direccionables de forma independiente, la retención
  de resultados, la capacidad de solapamiento, el retraso, la forma de los
  resultados negativos/pendientes y el comportamiento ante fallos/calidad de
  eventos.
- La razón tipada de omisión y la representación en la traza de los cruces
  múltiples de una programación, los límites completos de hechos del proveedor,
  la capacidad del libro mayor de ocurrencias, la codificación de la
  reproducción y el manejo de correcciones.
- Cualquier diseño de bytes concreto, ABI, presupuesto de almacenamiento, regla
  de desbordamiento o capacidad de proveedor de despliegue.
