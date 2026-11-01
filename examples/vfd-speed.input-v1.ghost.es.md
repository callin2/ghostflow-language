<!-- translation-source: examples/vfd-speed.input-v1.ghost.md -->
[Original en inglés](vfd-speed.input-v1.ghost.md)
> Traducción de lectura. Para compilar, use el archivo original `.ghost.md` enlazado.

# Velocidad del VFD: revisión explícita de entradas

<!-- source-revision: issue531-input-quality-vfd-v1 -->

Start y stop son verdaderos mientras se mantienen pulsados. El productor suministra
observaciones del potenciómetro en voltios; el rango de operación previsto sigue siendo
de 0 a 10 V. La velocidad sigue siendo independiente de Run. Este ejemplo virtual
conserva su latch existente, sensible al nivel, para condiciones sanas: un START no
disponible no puede iniciar una marcha; un STOP no disponible inhibe Run. Son ramas
explícitas de la fuente para la calidad del productor, no diagnósticos de botones
físicos. La visualización de velocidad empieza en 0 V y recuerda su última observación
aceptada cuando la calidad no está disponible. Esa inicialización de la visualización
no es una muestra Good sintetizada. La fuente y el escenario anteriores se conservan
intactos como evidencia histórica.

```ghost
control VfdSpeed {
  input start, stop: Bool;
  input potentiometer_v: Number;
  output run: Bool;
  output speed_v, speed_hz: Number;
  state running: Bool = false;
  state observed_speed_v: Number = 0.0;
  // Preserve the existing healthy STOP priority and level-sensitive latch.
  running' = case stop {
    ok(stopped) => !stopped && (case start { ok(requested) => requested || running; fault(_) => running; });
    fault(_) => false;
  };
  run <- running';
  // Authored display memory is separate from producer acquisition evidence.
  observed_speed_v' = case potentiometer_v { ok(value) => value; fault(_) => observed_speed_v; };
  speed_v <- observed_speed_v';
  speed_hz <- observed_speed_v' * 5;
}
```
