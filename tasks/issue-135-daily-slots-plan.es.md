<!-- translation-source: tasks/issue-135-daily-slots-plan.md -->
[Original en inglés](issue-135-daily-slots-plan.md)

# Issue 135: ejecución de DailySlots literales

Seguimiento: https://github.com/callin2/ghostflow-language/issues/135

**Estado:** los cuatro pasos están completos.

## Alcance

- **Objetivo:** ejecutar `REF-03-032`, sin cambios, mediante el runtime
  (entorno de ejecución) de programación horaria compartido de Rust.
- **Soportado:** selecciones literales de `DailySlots<15min>` con `pulse`,
  `trusted_only`, `baseline` y `skip`.
- **Aún no ejecutable:** `REF-03-057`, seleccionado por config, sigue siendo un
  descriptor no ejecutable hasta que existan la edición de ajustes con clave y la
  persistencia.

## Pasos

1. [x] Agregar GFB9/control-v8 para el descriptor literal de DailySlots y claves
   estables de franjas literales.
2. [x] Extender los hechos de programación horaria de Rust y la identidad de
   admisión con el día de origen, la clave de franja y el pliegue (fold) de DST.
   Rust conserva la titularidad del predicado, el cruce, el libro mayor (ledger)
   terminal y la transacción.
3. [x] Agregar GFSF v3, WASM público e integración con ghostsim con hechos de
   proveedor explícitos. Rechazar resultados faltantes, obsoletos, malformados y
   calculados por quien llama.
4. [x] Demostrar la fuente de la Referencia sin cambios mediante pruebas nativas,
   de WASM y del simulador, incluidas la capacidad acotada y la reversión
   atómica.

Fuera de alcance: revisiones de Device, afirmaciones sobre salidas físicas y
cambios en la fuente o las expectativas de la Referencia.
