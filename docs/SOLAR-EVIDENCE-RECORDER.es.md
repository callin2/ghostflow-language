<!-- translation-source: docs/SOLAR-EVIDENCE-RECORDER.md -->
[Original en inglés](SOLAR-EVIDENCE-RECORDER.md)

# Evidencia de escaneos Solar aceptados

`SolarEvidenceRuntime` en `runtimes/wasm/solar-evidence-runtime.mjs` es un
registrador acotado de host de referencia para REF-03-028. Registra evidencia
sobre los escaneos que el runtime aceptó.

- Instancia el runtime WASM de Rust con tramas compartido existente de Solar/configuración.
- Antes de crear ese propietario, valida la fuente canónica, el bytecode, el
  manifiesto y los metadatos de traza.
- No cambia la semántica de admisión y no opera hardware.

**Entradas e identidades.** Quien llama proporciona:

- un artefacto canónico compilado;
- los bytes WASM;
- la activación de contexto;
- un `runId` explícito.

El SHA256 del documento fuente es la revisión de la definición. El SHA256 del
artefacto identifica los bytes ejecutables. El registrador no emite identidades
de instalación, de fuente ni de ejecución.

El perfil admitido es el perfil existente GFB16 de pulso/configuración Solar
compartida. Quien llama proporciona hechos de proveedor finitos y evidencia de
reloj explícita. El registrador no afirma ninguna autenticidad astronómica.

**Qué conserva cada paso aceptado.** Cada `step(frame)` aceptado conserva:

- el resultado consolidado completo y el punto de control (checkpoint) de contexto real;
- los hashes de la fuente y del artefacto;
- la identidad de ejecución, de escaneo y de tiempo lógico;
- la revisión del reloj.

Las filas de traza originales del núcleo conservan sus decisiones.

**Recibos de admisión.**

- Un recibo `Due` aceptado real establece la admisión para la identidad pública
  de su ocurrencia.
- Una fila de proveedor posterior con la misma identidad registra además
  `AlreadyAdmitted`, el día de origen, el instante planificado actual, las
  revisiones de proveedor/contexto, la disponibilidad y la cobertura, y una
  copia del recibo de admisión original.
- Los metadatos de admisión originales y los metadatos de predicción revisados
  se mantienen separados.
- Una clave terminal de omisión en el arranque nunca se presenta como admisión.

**`booleanProjection`.** Describe el escaneo aceptado actual de la programación horaria.

- Una ocurrencia antigua conservada tiene `occurrenceDue: false`, incluso si una
  ocurrencia nueva y diferente hace que el Bool de la programación horaria de
  ese escaneo sea verdadero.
- El `coreDecision` en bruto sigue visible. El punto de control portable actual
  de claves terminales no puede, por sí solo, distinguir una ocurrencia admitida
  de una omitida. El registrador del host aporta esa clasificación a partir de
  recibos aceptados reales; no vuelve a etiquetar la decisión del núcleo.

**Rechazos, límites y vida útil.**

- Las tramas rechazadas no agregan evidencia y conservan el punto de control de contexto real.
- `observe()` devuelve copias independientes.
- El propietario permite como máximo 256 recibos y un presupuesto de trama JSON de 1 MiB.
- Debe liberarse (dispose) después de usarlo.
- No hay un destino físico, un escritor duradero ni una API de restauración del
  punto de control de contexto.
- Una activación nueva puede reproducir la evidencia volviendo a reproducir
  (replay) las tramas registradas. Restaurar solo un punto de control **no**
  restaura el historial de admisión de este host.
- El almacenamiento duradero y la recuperación tras un fallo siguen siendo
  responsabilidad del host externo.

**Pruebas.** Las pruebas enfocadas:

- comparan los resultados y puntos de control completos de Rust nativo y de WASM;
- ejecutan una admisión genuina y una reobservación con due false;
- conservan los hechos revisados bajo la misma identidad de ocurrencia;
- reproducen una activación nueva;
- comprueban registros simultáneos de ocurrencias antiguas y nuevas;
- rechazan metadatos de fuente falsificados antes de la activación;
- distinguen la evidencia faltante, no válida y obsoleta (stale) del historial admitido.

Estos son resultados de un host de referencia de software, no una prueba del
comportamiento de Device ni de la actuación física.
