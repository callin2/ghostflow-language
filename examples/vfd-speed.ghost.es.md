<!-- translation-source: examples/vfd-speed.ghost.md -->
[Original en inglés](vfd-speed.ghost.md)
> Traducción de lectura. Para compilar, use el archivo original `.ghost.md` enlazado.

Start y stop son verdaderos mientras se mantienen pulsados. La entrada del potenciómetro es válida de 0 a 10 V. La referencia de velocidad es independiente de la señal de marcha (Run).

```ghost
control VfdSpeed {
  input start, stop: Bool;
  input potentiometer_v: Number;

  output run: Bool;
  output speed_v, speed_hz: Number;

  state running: Bool = false;

  // Start latches ON. Stop takes priority.
  running' = !stop && (start || running);
  run <- running';

  // Speed reference remains independent of Run.
  speed_v <- potentiometer_v;
  speed_hz <- potentiometer_v * 5;
}
```
