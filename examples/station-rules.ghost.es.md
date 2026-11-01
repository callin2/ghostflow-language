<!-- translation-source: examples/station-rules.ghost.md -->
[Original en inglés](station-rules.ghost.md)
> Traducción de lectura. Para compilar, use el archivo original `.ghost.md` enlazado.

# Política compartida de la estación

Este documento literario (literate) canónico declara límites de estación
propiedad del host y enclavamientos de modo para una bomba compartida. Es el
**perfil de adaptador Station** acotado: un conjunto de reglas fijo y finito
que consumen `ghostrules` y `bindStationPolicy`. No es la gramática general de
restricciones propiedad del control.

El perfil tiene dos consumidores concretos: la demostración de la estación y la
prueba de Station WASM del libro de programación. Este perfil se conserva para
que esos consumidores sigan funcionando. No habilita políticas arbitrarias de
salida de recursos compartidos.

El host debe vincular explícitamente:

- las identidades station, pump1, settings y starts;
- los alias de modo y de actividad;
- la configuración finita del número de válvulas.

La vinculación completa y el ciclo de vida ejecutable de Station se comprueban
en `tests/programming-book-simulation.test.mjs` y `tests/policy.test.mjs`.
El contrato fijo de Station es el dueño de su comportamiento de parada; esta
fuente no define una secuencia segura física genérica. `check pump_capacity`
es solo de carácter consultivo.
Para una envolvente local completa propiedad de un solo control, consulte
[constraint-envelope.ghost.es.md](constraint-envelope.ghost.es.md).

`Station::session_actual_on_ms(session_id)` (Rust) y `sessionActualOnMs(sessionId)`
del wrapper WASM leen el tiempo acumulado de bomba en ON aplicado, en
milisegundos, de la sesión activa correspondiente:

- El resultado de WASM es un `BigInt` exacto.
- El getter no hace avanzar el tiempo. Las operaciones de Station existentes
  con marca de tiempo, incluida `advance`, integran el estado `reportApplied`
  del host.
- Los intervalos en OFF conservan el total de la sesión. Por ejemplo, diez
  segundos en ON, diez en OFF y luego veinte en ON dan `30_000n` en el instante
  40,000ms.
- `dailyUsedMs` permanece sin liquidar hasta la finalización duradera de la
  sesión.
- Una sesión ausente, que no coincide, finalizada o restaurada no devuelve
  cero. Rust devuelve `SessionMismatch` y el wrapper lanza una excepción.
- La restauración mantiene el contrato existente de reserva conservadora y de
  recuperación. No restaura el contador de la sesión activa.

Esta observación pertenece únicamente al adaptador Station acotado. No define
un contador genérico de trabajos, la antigüedad de una fase, un temporizador
continuo de ON ni la contabilización de uso de las salidas solicitadas, seguras
o confirmadas. Los estados aplicados en las pruebas del host son fixtures, no
retroalimentación física. Las distinciones trazadas en la
[Referencia §3.4](../docs/reference/03-time-and-schedules.es.md)
siguen siendo contratos separados bajo [#208](https://github.com/callin2/ghostflow-language/issues/208).

```ghost
constraints StationRules {
  exclusive(automatic, manual, configuring);

  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);
  allow apply(settings)
    only when mode == Configure && stopped(station);

  require count_on(pump1.valves) <= 2;
  require pump1.on => any_on(pump1.valves);
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
  once starts per occurrence;
  check pump_capacity(pump1);
}
```
