<!-- translation-source: tasks/import-validation-plan.md -->
[Original en inglés](import-validation-plan.md)

# Validación de importaciones fijadas

Fuente de verdad: Referencia del lenguaje §6.4–6.7. Este documento sigue el
progreso de la implementación y la planificación. No reemplaza la especificación
del lenguaje.

**Cómo leer este documento.** La primera sección describe el estado actual
(2026-09-23). Las secciones posteriores son un registro de hitos anteriores, que
se conserva como historial. Las afirmaciones que contienen, como «REF-06-010
sigue en RED», «el reductor (lowerer) rechaza toda importación analizada» o «no
existe una API pública sourceClosure», eran ciertas en ese hito y quedan
reemplazadas por el estado actual.

## Porción ejecutable actual (2026-09-23)

**Estado.** REF-06-010 ahora aprueba la verificación de la CLI y la compilación
del artefacto. Las notas anteriores sobre rutas no soportadas que aparecen más
abajo describen hitos previos.

**Cierre de fuentes (source closure).** `compileSource` acepta un
`sourceClosure: [{ filename, revision, text }]` explícito.

- Verifica de forma transitiva los resúmenes (digests) y las revisiones exactos,
  con código seguro para el navegador.
- No obtiene archivos ni recursos de red.
- La CLI reúne esos documentos canónicos desde el sistema de archivos.

**Soporte de composición.** La composición del AST soporta:

- puertos escalares de entrada/salida
- parámetros
- expresiones de estado y `let`
- instancias anidadas
- entradas obligatorias
- tipos de puerto exactos
- un único escritor

Se rechazan los ciclos combinacionales y la retroalimentación de estado siguiente
entre instancias. Los documentos y los nodos de origen por instancia permanecen
separados en el mapa del artefacto.

**Restauración de artefactos.** La restauración vuelve a compilar el cierre
completo y compara el bytecode, el manifiesto, la traza y la procedencia antes de
aceptar el artefacto.

**Límites del cierre.**

| Límite | Valor máximo |
| --- | --- |
| Documentos | 128 |
| Fuente total | 8 MiB |
| Instancias | 128 |
| Visitas de transformación de expresiones | 65 536 |

**Pruebas.** `tests/composition-execution.test.mjs` cubre el aislamiento de
estado en WASM de Rust, la resolución transitiva de fuentes, las conexiones no
válidas, las entradas faltantes, los errores de argumentos, la comprobación de
tipos de salidas no usadas y la manipulación de artefactos/procedencia.

**La composición de sensores y de funciones puras** se agregó en
[#377](https://github.com/callin2/ghostflow-language/issues/377).

- Los paquetes sin procesar raíz se distribuyen a acondicionadores
  independientes por instancia.
- Los sensores públicos permanecen en `manifest.sensors`. Los descriptores
  privados están en `manifest.sensorInstances`, con `sourceSensor`, `instance` y
  `port`.
- La carga útil, la opcionalidad y el intervalo de muestreo declarado deben
  coincidir.
- Los parámetros de función y las vinculaciones de `case` siguen siendo léxicos.
- La cobertura focalizada incluye filtrado independiente, fallos, recuperación,
  obsolescencia (stale), reversión de escaneo, rechazo de paquetes privados,
  restauración de fuentes y una comparación nativo/WASM de las tramas
  acondicionadas reales.
- El protocolo GFB/ABI/de tramas no cambia.

**Todavía no soportado:**

- composición de declaraciones timer/schedule/config/enum/resource/constraint
- expansión de enlaces de intención importados
- exportaciones públicas calificadas de funciones/tipos

Estos casos fallan de forma explícita en lugar de perder silenciosamente su
semántica de instancia. Las etiquetas de revisión importadas se comprueban contra
las identidades del cierre proporcionado; quien llama o el catálogo es
responsable de su autenticidad.

## Porción implementada del analizador

*Hito histórico.*

`ControlParser` acepta encabezados de importación fijados en el nivel superior y
los guarda en una lista `imports` separada del AST. Cada entrada conserva:

- el alias
- el localizador relativo `.ghost.md`
- la revisión
- el resumen (digest)
- la identidad del nodo de origen
- las ubicaciones de token de cada campo fijado

Informa estos errores en el token escrito por el autor: revisión/resumen
faltante, sintaxis de resumen no válida, revisión vacía/latest, localizador no
canónico/absoluto/de red, y alias duplicados. Se aplica la reasignación existente
de diagnósticos literate.

El reductor rechazaba toda importación analizada antes de la compilación con:
`import execution requires a verified source closure and composition lowering,
which are not yet supported`. Las importaciones no podían ignorarse en silencio,
ni siquiera las no usadas. Analizar una cadena de revisión no vacía no demuestra
que la revisión del resolvedor sea inmutable.

Evidencia de TDD:

- `build/import-header-red.log`: 14 pruebas, todas fallidas en el límite antiguo
  del analizador.
- `build/import-header-green.log`: 272/272 pruebas de sintaxis focalizadas y
  afectadas aprobadas, incluidas las 14 pruebas nuevas de
  `tests/import-header.test.mjs`.
- La nueva suite está registrada explícitamente en `tools/verify-language.mjs`.

En este hito, REF-06-010 todavía carecía de composición aceptada. Su expectativa
de aceptación y todas las demás expectativas de la Referencia permanecieron sin
cambios.

## Porción de sintaxis de parámetros y composición

*Hito histórico.*

**Parámetros.** Los valores predeterminados de `parameter` se compilan como
valores inmutables tipados y se registran en `manifest.parameters`, de forma
independiente de los ajustes del operador.

- Las referencias adelantadas a parámetros se resuelven sin depender del orden
  de declaración.
- Se rechazan los valores predeterminados cíclicos, los errores de tipo y las
  dependencias de input, state o config mutable.

**Sintaxis de composición.** El analizador conserva las declaraciones
`instance`, los argumentos de especialización con nombre y los extremos de
`connect` con sus posiciones de origen originales. La validación local de la
composición rechaza:

- alias de importación/instancias desconocidos
- declaraciones de instancia y argumentos duplicados
- direcciones de puerto raíz no válidas
- proveedores en competencia, incluida una salida raíz definida a la vez por una
  expresión y por `connect`

**Límites en este hito.** El compilador público todavía rechazaba importaciones
válidas sin un cierre de fuentes verificado. No garantizaba nombres/tipos de
argumentos importados, puertos obligatorios, contratos exactos de puertos y
sensores, aislamiento de instancias ni composición ejecutable.

**Evidencia.**

- REF-06-010 seguía en RED.
- REF-06-103 ahora aprueba con el diagnóstico real de proveedor duplicado.
- `tests/import-composition.test.mjs` tiene 21 pruebas focalizadas aprobadas.
- La ejecución combinada de import/header/digest/control/compiler aprueba 42/42.

## Siguiente límite mínimo de implementación

*Plan histórico.*

En ese momento, `tools/compile-source.mjs`, neutral respecto al entorno, aceptaba
un único documento canónico y no tenía entrada de resolvedor/cierre de fuentes.
`tools/ghostc.mjs` solo leía el documento raíz. Una siguiente porción completa
necesitaba:

1. Un contrato explícito de cierre de documentos proporcionados que transporte el
   nombre de archivo/localizador canónico de cada uno, la identidad de revisión
   inmutable, el texto original y el resumen UTF-8 verificado. Usar el mismo
   validador para el navegador y Node. El validador no debe obtener archivos ni
   datos de red de forma implícita.
2. Extracción de encabezados de importación reutilizable sin analizar los
   cuerpos de instancia (entonces no soportados). Reutilizar las reglas de tokens
   del analizador en lugar de un escáner con expresiones regulares.
3. Resolución de localizadores relativos respecto al documento que importa. La
   resolución solo se hace dentro del cierre proporcionado; la grafía del
   localizador no es la identidad de la fuente.
4. Diagnósticos para dependencias faltantes, desacuerdo de revisión, discrepancia
   de resumen, vinculación ambigua de localizadores y ciclos de importación
   transitivos, cada uno conservando el tramo de origen del documento que
   importa. Validar las dependencias transitivas, no solo las importaciones raíz.
   Conservar la prosa completa original y las identidades en el resultado
   verificado.
5. Integración en el compilador público que valide el cierre pero siga
   rechazando la ejecución de instancias hasta que se implementen la reducción
   (lowering) de composición y la procedencia. La recopilación desde el sistema
   de archivos de la CLI es un adaptador aparte hacia ese mismo contrato.

**Pruebas requeridas.** Emparejar un cierre fijado válido de dos niveles con cada
corrupción aislada. Cubrir también la reutilización en diamante, la reutilización
de alias en definiciones distintas, la normalización de rutas, los ciclos y los
límites de recursos de bytes/documentos. La validación no debe alterar un cierre
proporcionado.

El contrato de entrada seguía siendo una decisión de diseño del integrador
principal; la porción del analizador no agregó ninguna API pública especulativa
de resolvedor.

Después de eso, REF-06-010 requería además el análisis de instance/parameter/connect,
el aislamiento de estado por instancia, la comprobación exacta de puertos/calidad,
el orden de dependencias, las restricciones transitivas de estado siguiente, un
único escritor y la procedencia de fuente/revisión. Aplanar el texto fuente y
descartar las identidades originales de los documentos no es un atajo aceptable.

## Comprobación previa directa de resúmenes en la CLI

*Hito histórico.*

Esta pequeña porción reside en `tools/ghostc.mjs`. Antes de analizar los cuerpos
de instancia no soportados, la CLI:

1. reutiliza `parseControlImports` para inspeccionar los encabezados de
   importación;
2. resuelve cada localizador relativo directo respecto al nombre de archivo raíz
   que importa;
3. compara el SHA-256 fijado con los bytes originales del archivo.

La prosa importada, la codificación UTF-8 y los bytes CRLF participan sin
cambios. El UTF-8 no válido, los documentos sobredimensionados, los archivos
ilegibles y las discrepancias de resumen se rechazan en el token de importación
escrito por el autor antes de publicar un artefacto.

En este hito se trataba solo de una validación directa de integridad en el
sistema de archivos: no había API pública sourceClosure, resolvedor recursivo,
prueba de autenticidad de revisiones ni composición aceptada. Una dependencia
coincidente seguía llegando a la ruta existente no soportada del compilador. La
compilación en el navegador no obtiene archivos mediante este auxiliar de la CLI.

**Evidencia.** `tests/import-cli-digest.test.mjs` ejecuta el fixture REF-06-102
sin cambios en los modos de verificación (check) y de compilación (build). Cubre
la coincidencia exacta de UTF-8/CRLF, la manipulación de la prosa importada, la
preservación de un artefacto existente, los archivos faltantes y el UTF-8 no
válido.

- `build/import-cli-digest-red.log` registró cuatro fallos y un control de ruta
  no soportada que ya aprobaba.
- `build/import-cli-digest-green2.log` registra 156/156 pruebas aprobadas,
  incluidos los cinco casos nuevos, la cobertura del analizador de importaciones
  y la suite completa existente de diagnósticos de sintaxis de la CLI.
- No cambió ninguna expectativa de la Referencia.
