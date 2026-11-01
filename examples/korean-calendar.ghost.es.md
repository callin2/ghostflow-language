<!-- translation-source: examples/korean-calendar.ghost.en.md -->
[Original en inglés](korean-calendar.ghost.en.md)
> Traducción de lectura. Para compilar, use el archivo original en coreano [`korean-calendar.ghost.md`](korean-calendar.ghost.md).

# Días festivos oficiales de Corea y días laborables de la granja

[Original en coreano](korean-calendar.ghost.md)

Los días festivos oficiales y los días laborables de la granja responden a
preguntas distintas. El 9 de octubre de 2026 es el Día del Hangeul, un día
festivo oficial. Aun así, la granja puede decidir trabajar ese día por la
cosecha. Esa decisión no cambia el hecho del día festivo oficial: el día sigue
siendo festivo.

El programa siguiente vincula cada calendario de forma explícita. Tres
programaciones evalúan la misma ocurrencia civil de las 06:00, una por cada
pregunta:

| Programación | Calendario | Filtro de día | Salida |
|---|---|---|---|
| `public_morning` | `public_days` | `holiday` | `public_holiday` |
| `farm_morning` | `farm_days` | `workday` | `farm_work` |
| `rest_morning` | `farm_days` | `offday` | `farm_rest` |

Las salidas son valores Bool virtuales en el simulador. No accionan ningún
dispositivo.

```ghost
control KoreanCalendar {
  calendar public_days: HolidayCalendar;
  calendar farm_days: WorkCalendar;
  schedule public_morning: Daily {
    timezone = "Asia/Seoul";
    at = time`06:00`;
    on = day`holiday`;
    calendar = public_days;
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  schedule farm_morning: Daily {
    timezone = "Asia/Seoul";
    at = time`06:00`;
    on = day`workday`;
    calendar = farm_days;
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  schedule rest_morning: Daily {
    timezone = "Asia/Seoul";
    at = time`06:00`;
    on = day`offday`;
    calendar = farm_days;
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output public_holiday: Bool;
  output farm_work: Bool;
  output farm_rest: Bool;
  public_holiday <- public_morning.due;
  farm_work <- farm_morning.due;
  farm_rest <- rest_morning.due;
}
```

Una copia recién clonada necesita Rust/Cargo y Node.js. Desde la raíz del
repositorio, instale el destino WASM y compile el runtime; después ejecute el
ejemplo. Añada `--offline` a Cargo solo cuando las dependencias ya estén en
caché.

```sh
rustup target add wasm32-unknown-unknown
cargo build --locked -p ghostflow-wasm --target wasm32-unknown-unknown --release
node tools/examples/korean-calendar.mjs
```

El ejemplo construye primero el calendario oficial coreano a partir de datos
fijados de 2026–2027. Después deriva explícitamente un calendario de la granja:
trabajo de lunes a viernes y descanso en los días festivos oficiales. A
continuación compone dos excepciones con un nuevo ID y una nueva revisión: el
9 de octubre pasa a ser día laborable y el 12 de octubre pasa a ser día de
descanso. Ambos calendarios originales permanecen sin cambios.

Los resultados de las 06:00, en el orden `public_holiday, farm_work, farm_rest`:

| Día | Resultado |
|---|---|
| 9 de octubre (festivo oficial, la granja trabaja) | `true, true, false` |
| 12 de octubre (día de descanso de la granja) | `false, false, true` |
| La misma ocurrencia suministrada de nuevo | todos `false` |

El host solo suministra hechos explícitos de fecha y hora civil en la zona
horaria fija de Corea. El núcleo de Rust clasifica los días festivos, evalúa
`due` y evita los duplicados. Si un calendario falta o ha vencido, la
programación se omite según `fallback = skip`. Los futuros días festivos
temporales nunca se infieren automáticamente: revise la nueva evidencia oficial
y componga un calendario nuevo. Este ejemplo no añade ninguna sintaxis literal
para los días de la semana.
