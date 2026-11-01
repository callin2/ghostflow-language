<!-- translation-source: CONTRIBUTING.md -->
[Original en inglés](CONTRIBUTING.md)

# Cómo contribuir a GhostFlow

[English](CONTRIBUTING.md) · [한국어](CONTRIBUTING.ko.md) · Español

Esta guía está dirigida a los agentes de codificación y a las personas que revisan
su trabajo. Es un punto de entrada a las reglas del repositorio, no un sustituto
de ellas. Para conocer las reglas completas, lea:

- [`AGENTS.md`](AGENTS.es.md) para la titularidad y las restricciones del
  lenguaje.
- [`docs/DEVELOPMENT-WORKFLOW.md`](docs/DEVELOPMENT-WORKFLOW.es.md) para el
  dimensionamiento de tareas, las entregas y la reutilización de evidencia.

En resumen, una contribución tiene cuatro pasos: partir de `dev`, definir una
tarea acotada, cambiar el código y la documentación a la vez, e informar la
evidencia con claridad.

## Partir de la rama de desarrollo actual

Comience el trabajo nuevo a partir de `dev`. Antes de editar nada:

1. Confirme la raíz del repositorio y la rama.
2. Registre el base SHA exacto con `git rev-parse HEAD`.
3. Inspeccione `git status`.

Preserve los cambios no relacionados. No adivine el contenido de un checkout
temporal a partir de su nombre.

Busque en el índice de documentos antes de leer archivos de diseño o de
implementación:

```sh
npm run docs:find -- --limit 8 QUERY
```

El índice busca solo en rutas y títulos, no en el texto completo. Para buscar en
el contenido, use `rg` o abra los documentos encontrados. Si el índice está
desactualizado o no existe:

- Durante una exploración de solo lectura, infórmelo.
- Durante un trabajo de documentación autorizado, actualícelo después del lote de
  ediciones.

## Definir una tarea acotada

Algunas tareas tienen un oráculo derivado del campo (resultados esperados
derivados de un caso real en campo y especificados con independencia de la
implementación) y evidencia de mutación acotada. Para una tarea concreta de ese
tipo, use el [paquete de contribución con IA](docs/AI-CONTRIBUTION-PACKAGE.es.md).
Las plantillas de issue y de PR recogen sus identidades mínimas, su alcance y su
evidencia independiente.

Antes de empezar, anote:

- el resultado previsto;
- los archivos o límites que le corresponden;
- los criterios de aceptación;
- los requisitos previos;
- el comando de verificación específico.

Mantenga diferenciado el trabajo completado, el bloqueado y el independiente. No
añada alcance funcional ni limpiezas que la solicitud no necesite.

**Corregir un error:**

1. Capture una reproducción que falle antes de cambiar el código.
2. Añada una comprobación de regresión significativa que fallaría sin la
   corrección.
3. Mantenga intactos el oráculo de pruebas existente y los controles del
   repositorio.

Para el comportamiento del lenguaje, preserve la fuente canónica `.ghost.md` y los
límites de titularidad descritos en `AGENTS.md`. Registre los cambios de reglas
del lenguaje y las correcciones de errores que cambien el comportamiento
observable del lenguaje en ambos archivos de changelog de la raíz, como se
describe en el
[flujo de trabajo de desarrollo](docs/DEVELOPMENT-WORKFLOW.md#language-rule-changelog).

## Cambiar y documentar a la vez

Haga el cambio completo más pequeño posible. En la misma tarea, actualice:

- la implementación;
- la cobertura de regresión;
- la documentación pertinente en inglés y en coreano.

Mantenga idénticos los ejemplos ejecutables en todas las traducciones. Actualice
los hashes revisados y los metadatos del catálogo según lo exige
[`docs/DOCUMENTATION-LANGUAGES.md`](docs/DOCUMENTATION-LANGUAGES.es.md).

Para comprobar el alcance admitido actualmente y su evidencia, use
[`docs/REFERENCE-FEATURE-STATUS.md`](docs/REFERENCE-FEATURE-STATUS.es.md). Para los
controles reales del host y sus límites, use
[`docs/VERIFICATION.md`](docs/VERIFICATION.es.md). Ejecute las comprobaciones
específicas pertinentes y la CI obligatoria del repositorio. No debilite ni omita
una comprobación para obtener un resultado satisfactorio.

La CI elige su ruta de verificación a partir de los archivos modificados:

| Cambio | La CI ejecuta |
| --- | --- |
| Solo archivos ordinarios de README, contribución, catálogo, índice o ilustraciones del README | `docs:check` y regresiones del enrutamiento por rutas |
| Código, ejemplos ejecutables, especificaciones, contratos, política de verificación, cambios mixtos o rutas desconocidas | Verificación completa actual/del pin del frontend y cobertura |

Consulte el [flujo de trabajo de desarrollo](docs/DEVELOPMENT-WORKFLOW.es.md) para
ver la lista de permitidos exacta. La CI de solo documentación no emite ningún
artefacto WASM verificado. Si necesita uno, ejecute manualmente el flujo de
trabajo completo con el `source_sha` exacto. Este enrutamiento no le permite
omitir las comprobaciones locales pertinentes. Antes de fusionar, el
`Verification result` final debe estar en verde.

## Informar la evidencia con claridad

Abra los pull requests contra `dev`. Explique el cambio visible para el usuario y
por qué es necesario. Incluya:

- el enlace al issue;
- los comandos de verificación, con su estado de salida y sus resultados;
- los límites restantes.

Indique lo que no se verificó. No dé a entender que las pruebas en el host
demuestran la aceptación del Device, física o del agricultor. Si una comprobación
no pudo ejecutarse, informe el impedimento exacto.

Cuando cree un issue, aplique al menos una etiqueta de módulo pertinente, como
`module:ghostflow-toolchain`. Si no puede aplicar la etiqueta, pida a un
mantenedor que lo haga.

Los mantenedores promueven los cambios verificados de `dev` a `main`.

Use esta entrega compacta para una tarea o un pull request:

```text
Resultado:
Alcance y archivos que le corresponden:
Completado / bloqueado / independiente:
Criterios de aceptación:
Requisitos previos y restricciones:
Comando de verificación específico:
Devolver: archivos modificados, comandos y resultados, riesgos o impedimentos restantes.
```

Para los lotes de documentación, ejecute `npm run docs:index` una vez y luego
`npm run docs:check`. Para otras comprobaciones aplicables, consulte los
documentos del flujo de trabajo y de verificación.
