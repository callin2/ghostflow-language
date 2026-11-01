<!-- translation-source: .github/pull_request_template.md -->
[Original en inglés](pull_request_template.md)

## Problema y comportamiento resultante

IDs de issue / contrato y rutas de documentos requeridas:
Base SHA / candidate SHA exactos / rutas de fuentes y fixtures:
Alcance permitido y requisitos previos:

## Oráculo independiente y verificación

Resultados esperados y su fuente autorizada (no generados a partir de esta implementación):
Comandos antes / después, códigos de salida, resultados e identidades exactas de artefactos/informes:
Casos límite / de fallo, y el resultado de debilitar deliberadamente la protección:
Comprobaciones de regresión y limitaciones restantes (host / Device / físicas):

## Revisar por separado la evidencia modificada

- [ ] Revisé cualquier eliminación o debilitamiento de una regla de protección por separado de las modificaciones de valores esperados.
- [ ] Revisé los cambios del oráculo, las aserciones perdidas, las pruebas eliminadas/omitidas/marcadas como todo y los cambios en la lista de runners.
- [ ] Revisé los cambios en requirement status, testIds, locator digest y pendingReason.
- [ ] Expliqué el riesgo de que la implementación y sus pruebas compartan el mismo malentendido; la concordancia native/WASM es solo evidencia de portabilidad.
- [ ] Todo cambio legítimo de especificación cita evidencia autorizada y una revisión de significado independiente.
- [ ] La documentación bilingüe/el changelog pertinentes y los controles obligatorios del repositorio siguen intactos.

Referencia: [paquete de contribución acotado](../docs/AI-CONTRIBUTION-PACKAGE.es.md).
