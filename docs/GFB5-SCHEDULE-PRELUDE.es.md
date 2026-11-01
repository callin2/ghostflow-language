<!-- translation-source: docs/GFB5-SCHEDULE-PRELUDE.md -->
[Original en inglés](GFB5-SCHEDULE-PRELUDE.md)

# Preludio de programaciones GFB5

GFB5 es un perfil de bytecode **interno** que añade entradas de programación
(actualmente Solar) al *preludio* de cada estrategia: una lista de entradas de
ventana y de programación a las que pueden hacer referencia las transiciones y
las intenciones de la estrategia. Su estado actual:

| Parte | Estado |
| --- | --- |
| Codificador | implementado |
| Verificador estructural portable en Rust | implementado |
| Reducción (lowering) de la fuente canónica | no conectada |
| Ejecución de programaciones | no conectada |
| Carga | tiene éxito para módulos estructuralmente válidos |
| Activación, planificación temporal, intercambio en caliente | se rechazan con `schedule activation requires runtime bindings` |

## Formato

El magic sigue siendo `GFB1`; la versión de formato little-endian es `5`.

- Las secciones de módulo, entradas, estado y reloj/raíz temporal conservan su
  formato existente.
- Los módulos que solo contienen programaciones pueden tener cero raíces
  físicas. Las ventanas siguen requiriendo referencias de raíz válidas.
- Un módulo de formato 5 debe contener al menos una programación. Para los
  módulos que solo contienen ventanas, el codificador sigue emitiendo el
  formato 4.

Cada estrategia tiene un contador de preludio `u16`, seguido de esa cantidad de
entradas etiquetadas:

- La etiqueta `0` contiene el cuerpo de ventana GFB4 existente.
- La etiqueta `1` contiene este cuerpo Solar:

| Campo | Codificación y dominio |
| --- | --- |
| site | `u32`, positivo |
| name | Cadena GFB existente |
| timezone | Cadena UTF-8 no vacía y bien formada, de como máximo 128 bytes |
| latitude, longitude | `f64`, finito; −90..90 y −180..180 |
| event | `u8`: 0 salida del sol (rise), 1 puesta del sol (set) |
| offsetMs | `i64`: −86400000..86400000 |
| basis | `u8`: 0 pulse |
| clockPolicy | `u8`: 0 trusted_only |
| recovery | `u8`: 0 baseline |
| fallback | `u8`: 0 skip |
| gapMs | `u64`: 1..9007199254740991 |
| when | Blob de expresión existente, resultado Bool, como máximo 4096 bytes |

Todos los enteros son little-endian. Las etiquetas de política son explícitas;
cada campo de política tiene actualmente exactamente un valor definido. Otras
políticas del lenguaje requieren más implementación; este perfil no redefine
qué políticas admite el lenguaje. La disponibilidad de zonas horarias
corresponde a la vinculación del proveedor y no la establece la decodificación
estructural.

**Ranuras y referencias.**

- Las ranuras de ventana y las ranuras de programación se numeran por separado,
  en orden de aparición.
- El opcode 57 sigue leyendo ventanas. El opcode 58 es
  `[58, u16 scheduleSlot, u8 field]`, donde el campo 0 tiene tipo Bool (`due`).
- Cada expresión del preludio solo puede hacer referencia a entradas
  anteriores. Las transiciones y las intenciones pueden hacer referencia a todas
  las entradas.
- Los sites y los nombres deben ser únicos entre ambos tipos dentro de cada
  estrategia.
- Los estados escalares más las entradas del preludio no deben superar 128 por
  estrategia.

## Identidad y límites

El bytecode contiene la identidad semántica de las declaraciones locales. Los
hashes de documentos y las identidades externas de documento/revisión
permanecen en los metadatos verificados del artefacto. Los cambios de la fuente
que solo afectan a comentarios no deben alterar los bytes ejecutables.

Las formas internas del codificador son:

```text
(solar-pulse SITE NAME TIMEZONE LAT LON EVENT OFFSET_MS
  pulse trusted_only GAP_MS baseline skip WHEN)
(schedule-read SLOT due)
```

Estas formas no son un formato adicional de fuente del producto. La fuente del
producto sigue siendo un único documento `.ghost.md` completo.

La evidencia específica está en `tests/gfb5-schedule.test.mjs`,
`tests/gfb5-browser.test.mjs`, `tests/gfb5-native.test.mjs` y
`crates/ghostflow-core/tests/schedule_module.rs`.

- **Verifican:** los campos de transmisión, el orden de dependencias, las
  entradas mal formadas, los límites y el rechazo de la activación.
- **No establecen:** la admisión de reservas, la corrección del proveedor, la
  ejecución de programaciones, la identidad duradera, la contabilización de
  recursos ni la reproducción (replay).
