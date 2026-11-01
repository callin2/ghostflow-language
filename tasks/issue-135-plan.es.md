<!-- translation-source: tasks/issue-135-plan.md -->
[Original en inglés](issue-135-plan.md)

# Issue 135: primera porción ejecutable de programación horaria

Seguimiento: https://github.com/callin2/ghostflow-language/issues/135

Esta sesión de implementación fechada se dirige solo a `REF-03-024` (`Daily`).

- El fixture literate canónico sin cambios debe compilarse en un artefacto de
  control ejecutable y ejecutarse a través de la ruta existente de la VM de Rust.
- Un adaptador de host puede proporcionar un conjunto acotado y completo de
  hechos de ocurrencia.
- Rust sigue siendo responsable de la evaluación de predicados, el estado de
  reloj/admisión, las proyecciones, la consolidación de la transacción y la
  intención.

## Primero las pruebas

1. Registrar el fallo actual del fixture exacto en la puerta del artefacto
   descriptor.
2. Agregar un oráculo focalizado de Referencia ejecutable con una línea base de
   arranque y un cruce de Daily. Mantener sin cambios la fuente del fixture y el
   contrato de lenguaje esperado.
3. Agregar las comprobaciones de paridad nativo/WASM más pequeñas que soporten
   los arneses existentes del runtime de programación horaria.

## Límite de implementación

- Reutilizar `schedule_clock` y la maquinaria acotada de admisión/runtime de
  programación horaria.
- La revisión de arquitectura aprobó un descriptor Daily distinto GFB8/tag-3 y
  un manifiesto control-v7.
  - GFB7 sigue siendo solo para PID.
  - GFSF v2 transporta un tipo de disparador explícito y el pliegue (fold)
    civil.
  - Los consumidores actuales de Solar conservan GFSF v1.
- Mantener la generación de ocurrencias IANA y las revisiones de contexto en el
  límite del proveedor/adaptador. No agregar una VM de JavaScript para
  expresiones, estado, admisión ni intención.
- Preservar los motivos Unknown, la línea base de arranque/recuperación, la
  terminalización de brechas, la reversión, la identidad de ocurrencias, los
  campos de política de DST y la identidad exacta de la fuente.
- No cambiar el comportamiento de DailySlots, Periodic, Cron, TimeSlots,
  WorkCalendar ni Tide en esta porción.

## Titularidad de archivos

- El trabajador de issue-135 es titular de este plan, de los archivos
  focalizados de programación horaria/compilador/runtime y de las pruebas
  focalizadas de `REF-03-024`.
- No edita `tasks/plan.md` ni los casos del trabajador temporal.
- El fixture compartido `tests/reference/cases/02-time-control.json` es de solo
  lectura, salvo que se requiera un contexto de entrada ejecutable legítimo. Su
  fuente y sus expectativas permanecen sin cambios.

## Aceptación

- La prueba focalizada previa al cambio está en rojo por el motivo conocido de
  ser solo descriptor.
- La fuente sin cambios de `REF-03-024` produce un artefacto ejecutable.
- `ghostsim` ejecuta una línea base y un cruce de Daily aceptado a través de
  Rust.
- Las pruebas objetivo aprueban, y el cambio se confirma (commit) localmente sin
  push, merge, USB ni trabajo con hardware.

## Punto de control nativo/compilador (2026-09-24)

- **Commit:** `9916c41` implementa la porción de pulso Daily constante y puntos
  de entrada de activación/tick nativos/WASM distintos. Preserva la fuente
  REF-03-024 sin cambios.
- **Rojo registrado:**
  - fallo de ejecución de REF-03-024 por ser solo descriptor
  - identidad de pliegue faltante
  - contexto no disponible informado incorrectamente como BootBaseline
  - revisiones de proveedor/contexto perdidas en las observaciones Unknown
- **Verde:** pruebas nativas de programación horaria 24, pruebas de admisión 9,
  pruebas de pliegue 2; compilador, identidad de fuente, regresión de Solar y
  pruebas de WASM de bajo nivel de Daily 18.
- **Aún no afirmado:** la integración con el host ControlRuntime y con ghostsim
  se asigna por separado. Este punto de control no afirma que esa integración
  esté completa.
- **Detalles:** los detalles de la ABI y las responsabilidades del proveedor
  están en `docs/reports/2026-09-24-issue-135-daily-abi.md`.
