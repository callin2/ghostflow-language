<!-- translation-source: AGENTS.md -->
[Original en inglés](AGENTS.md)

# Titularidad del lenguaje GhostFlow

Estas son las reglas para los agentes de codificación con IA y demás
colaboradores que trabajan en este repositorio. Lea la primera sección antes de
cualquier tarea.

**Encontrar y mantener documentos**

- Use el [flujo de trabajo de desarrollo](docs/DEVELOPMENT-WORKFLOW.es.md) para
  búsquedas acotadas, ejecución delegada y reutilización de evidencia.
- Encuentre rutas y títulos de documentos con
  `npm run docs:find -- --limit 8 QUERY`.
- Después de un lote de ediciones de documentación, ejecute `npm run docs:index`
  y luego `npm run docs:check`.

**Usar la Referencia del lenguaje como fuente de verdad**

- Lea la [Referencia del lenguaje](docs/LANGUAGE-REFERENCE.es.md) antes de
  cualquier trabajo sobre el lenguaje, el runtime, los ajustes o el Interaction IR.
- Es la fuente de verdad compartida sobre la filosofía, la sintaxis, la semántica
  y el fundamento de las funcionalidades del lenguaje.
- No incluya en la referencia el estado de implementación ni informes de avance.
- Cuando cambie la semántica del lenguaje, actualice la sección correspondiente
  de la referencia y su fundamento.

**Registrar los cambios del lenguaje en el changelog**

- Registre cada cambio de una regla del lenguaje, y cada corrección de errores que
  cambie el comportamiento observable del lenguaje, en `CHANGELOG.md` y
  `CHANGELOG.ko.md` de la raíz, en el mismo PR.
- Siga el
  [procedimiento del changelog de reglas del lenguaje](docs/DEVELOPMENT-WORKFLOW.md#language-rule-changelog).

**Comprobar el ciclo de vida de las salidas antes de juzgarlo**

- Antes de juzgar el ciclo de vida de control/salida de GhostFlow, el
  comportamiento del simulador o la política de fallos de salida del Device, lea
  la [Referencia §4.7](docs/reference/04-sensors-constraints-control.es.md#47-requested-safe-applied-confirmed)
  y la [secuencia física](docs/LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary).
- Distinga el ciclo de vida del resultado del comando de la evidencia de salida
  requested, safe, applied y confirmed.
- Antes de afirmar que una política no existe o que el comportamiento físico está
  verificado, compruebe la revisión real del firmware de `farm-device` que se está
  revisando.

**Qué le pertenece a este repositorio**

Este repositorio es titular de la sintaxis, el análisis sintáctico, la tipificación,
el lowering y la codificación GFB1 de GhostFlow, de los motores portables de VM,
señales y estaciones en Rust, de su ABI WASM, y de los adaptadores de host de
referencia y las pruebas de conformidad. Cuando un cambio altere la semántica de
ejecución, mantenga juntos los cambios del compilador y del runtime.

## Límites

Otros repositorios y módulos son titulares de todo lo demás. Respete estos límites:

- **Host de la API.** El host de la API es titular de las solicitudes al LLM, el
  contexto de la instalación, el historial de conversaciones, el almacenamiento de
  revisiones del código fuente y la orquestación del despliegue. Un LLM redacta un
  candidato completo de GhostFlow; este compilador lo valida sin un LLM ni un
  servicio de API.
- **Repositorio Device.** El repositorio Device es titular del firmware, los
  perfiles de placa, los mapeos de pines, la integración de drivers/renderizadores,
  los watchdogs, los relojes y la E/S física.
  - Consuma el núcleo portable en una revisión explícita. Los cambios aquí no
    implican una versión del Device ni una verificación del hardware.
  - El código fuente de los drivers de entrada y de los renderizadores de salida
    pertenece a `farm-device-drivers`. Los renderizadores aplican las salidas
    lógicas a relés, motores, lámparas o pantallas; la interfaz del gabinete es
    `@ghostflow/cabinet-view`. Device es titular de la integración del host y la
    placa.
- **Frontend.** El frontend es titular de la interacción con el agricultor y la
  visualización. Las etiquetas de la instalación, las capacidades (capabilities) y
  las vinculaciones (bindings) son contexto externo. Las reglas ejecutables
  pertenecen al código fuente GhostFlow versionado y a sus artefactos compilados,
  no a un segundo programa en JSON.
- **Adaptadores de referencia.** `runtimes/wasm` y `runtimes/node/ledger.mjs` son
  adaptadores de referencia. Pueden validar manifiestos y suministrar entradas
  generadas, ocurrencias de programaciones y persistencia. La ejecución de
  expresiones, estado e intención permanece en el núcleo compartido de Rust.

## Trabajar aquí

**Mantener la documentación bilingüe**

- Mantenga versiones completas en inglés y en coreano de la documentación de
  autoría propia. Esto incluye filosofía, arquitectura, especificaciones, guías de
  la cadena de herramientas, planes de diseño y ejemplos educativos. Los informes
  y la evidencia de ejecución pueden quedar en un solo idioma.
- Conserve las rutas de origen existentes y añada una traducción hermana `.en.md`
  o `.ko.md`. Los ejemplos traducidos son proyecciones de lectura, nunca nuevas
  entradas canónicas de compilación.
- Actualice ambas versiones y sus hashes revisados en `docs/translations.json` en
  el mismo cambio. Registre allí cada exclusión de informes, artefactos generados
  o datos de prueba, con su motivo.
- Ejecute `npm run docs:check`. Los hashes establecen la vigencia, no la calidad
  semántica de la traducción.
- Consulte `docs/DOCUMENTATION-LANGUAGES.md` para la política completa y
  `docs/DOCUMENTATION.md` para el catálogo de documentos en inglés y coreano.

**Editar de forma segura y sin salirse del alcance**

- Use `apply_patch` para editar el código fuente y preserve el trabajo no
  relacionado.
- No añada a este repositorio servidores de producto, interfaces de prueba de
  concepto (POC), credenciales, conectores de modelos, firmware de placas,
  llamadas a dispositivos ni registros de conversaciones importados.
- Mantenga las pruebas enumeradas explícitamente en `tools/verify-language.mjs`;
  nunca descubra pruebas de productos hermanos mediante comodines.

**Verificar**

- Ejecute `npm test` para la verificación en el host después de instalar las
  dependencias y el target de Rust para WASM. Compila el fixture que requieren las
  pruebas de Rust antes de invocar Cargo, construye los runners WASM/nativos y
  ejecuta las pruebas del lenguaje y el tutorial.
- Cuando modifique ejemplos ejecutables de la FAQ y de programación, manténgalos
  en la comprobación del compilador específica
  `tests/docs-runnable-examples.test.mjs`.
- Después de editar cualquier archivo referenciado por
  `contracts/requirements/catalog.json`, ejecute
  `node --test tests/requirement-catalog.test.mjs`. Cuando se desplacen líneas,
  reubique los rangos de extractos sin cambios y preserve sus hashes esperados.
- Use `npm run test:portable-package` para comprobaciones específicas del paquete.
  Ejecuta la comprobación previa rápida del catálogo antes de las regresiones del
  paquete.

**Mantener la evidencia separada**

- Conserve los hashes del código fuente y de los artefactos en los registros de
  versión.
- Las trazas generadas de verificación y del tutorial son evidencia de ejecución
  ubicada en el directorio ignorado `build/`, separada de las versiones del código
  fuente.
- Informe la validación en el host por separado de la validación del Device, de
  la API y de la experiencia del agricultor.

**Proteger los benchmarks históricos**

- Nunca sobrescriba un benchmark histórico ni su digest fijado simplemente porque
  un cambio legítimo en el código fuente hizo que la CI informara una deriva de
  identidad.
- Mantenga separadas tres cosas: la procedencia actual derivada de los archivos
  extraídos, la integridad de la instantánea histórica fijada de forma
  independiente y las comparaciones de comportamiento medido.
- Diagnostique ese contrato antes de cambiar un hash. Capture un nuevo benchmark
  intencional en un nuevo artefacto con fecha. Cubra con pruebas de regresión los
  cambios de procedencia y la manipulación de registros almacenados.
- Consulte [`docs/2026-09-24-authoring-baseline-provenance.md`](docs/2026-09-24-authoring-baseline-provenance.md).

**Regenerar los digests de PC-01 cuando cambie el libro de programación**

- Cuando cambie el libro de programación, ejecute `npm run generate:pc01` antes de
  la verificación.
- El generador actualiza solo los digests del código fuente actual de PC-01 en el
  catálogo del currículo y en el manifiesto de reproducción (replay).
- Mantenga fijos los frames de reproducción, los puntos de control (checkpoints),
  las demás lecciones y la evidencia de benchmarks con fecha. Diagnostique
  cualquier discrepancia restante en lugar de reescribirla.

## Ruptura limpia de v1: solo fuente literaria canónica

- Esta cadena de herramientas previa a 1.0 acepta documentos de fuente literaria
  (literate) canónicos `.ghost.md` para la compilación de producto. Una vez que un
  reemplazo se acepta y verifica, elimine sus rutas activas de código
  fuente/API/respaldo (fallback) reemplazadas y sus pruebas de compatibilidad.
- Añada compatibilidad solo para una necesidad actual concreta y explícitamente
  aprobada de usuarios, datos o despliegue. El material histórico en bruto puede
  permanecer como evidencia claramente aislada, nunca como respaldo ejecutable.

## Identidad automática de compilación — System #199

Las compilaciones oficiales reciben un número de compilación de un asignador
compartido en línea.

**Asignación**

- `npm run build:wasm`, `make wasm`, `npm test` y los comandos directos del
  verificador asignan un número de compilación en línea mediante la herramienta
  System de bytes exactos fijada en `scripts/vendor/BUILD-IDENTITY.json`.
- Todos los crates de Cargo tienen actualmente la versión base 0.1.0. El hook de
  compilación comprueba esa concordancia antes de la asignación. Una divergencia
  futura requiere un contrato explícito de versión base de artefactos.
- No elija números manualmente ni eluda la protección interna.
- Cargo en bruto es compilación de dependencias/desarrollo, no una entrega oficial
  identificada.

**Registros de identidad**

- El archivo generado `build/build-identity.json` vincula la versión completa de
  compilación legible por humanos que se emitió con el SHA-256 real de la salida.
- La verificación completa incluye los hashes de salida nativos/framed y copia la
  identidad en su informe.
- El empaquetado de la CI verifica el SHA/código fuente real del WASM y coloca esa
  misma identidad en el manifiesto de entrega.
- El ABI y las exportaciones del runtime no cambian. El código fuente histórico
  fijado sin estos hooks no recibe un ID retroactivo.

**Fallos**

- Las recompilaciones fallidas invalidan la identidad anterior antes de la
  compilación y consumen su número.
- Mantenga la rama remota de solo metadatos `build-counter` fuera de cualquier
  limpieza.
- Una autoridad sin conexión o de solo lectura falla antes de la compilación;
  nunca adivine ni reinicie un contador.

**Pruebas y titularidad**

- `npm run test:build-identity` usa una autoridad local bare y un compilador
  sintético para probar la propagación de la identidad, el consumo de números en
  los fallos y las protecciones internas. No demuestra la compilación real de
  WASM; eso lo hacen los controles completos existentes de compilador/empaquetado
  de la CI.
- El asignador canónico compartido es propiedad de
  [System #199](https://github.com/callin2/farm_studio_system/issues/199).
  Preserve sus bytes incluidos (vendored) y su suma de verificación.
- El SHA del código fuente describe solo el HEAD confirmado en git (committed).

**Compatibilidad e identificadores**

La exportación de la migración preserva la semántica del compilador/runtime. Los
cambios de formato o de ABI requieren una decisión explícita de compatibilidad y
pruebas de conformidad. La versión del paquete, el perfil del lenguaje fuente, el
formato GFB1, el formato del manifiesto y la versión del firmware del Device son
identificadores distintos. Consulte `docs/IMPLEMENTATION.md` y
`docs/VERIFICATION.md`.
