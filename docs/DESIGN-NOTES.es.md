<!-- translation-source: docs/DESIGN-NOTES.md -->
[Original en inglés](DESIGN-NOTES.md)

# Notas de diseño del lenguaje

Esta página resume el razonamiento a nivel de lenguaje que hay detrás del
diseño de GhostFlow.

**La superficie elegida.** Un programa GhostFlow es un `control` con nombre.
Contiene:

- declaraciones tipadas;
- ecuaciones explícitas de estado siguiente;
- conexiones de intención de salida.

La fuente literaria (literate) coloca la explicación junto al código. La
semántica ejecutable y los diagnósticos mapeados no cambian. El compilador y el
runtime portable se versionan juntos. Como resultado, un mismo programa puede
examinarse mediante trazas nativas y WASM y luego ser consumido por un host de
dispositivo (Device host) compatible.

**Ejecución reproducible.** Cuatro propiedades hacen que la ejecución sea
reproducible:

- límites de estado explícitos;
- coste de las expresiones acotado;
- efectos restringidos;
- entradas del host explícitas.

Los sensores opcionales o los metadatos de la instalación no deben crear en
silencio supuestos sobre el equipo físico. Las restricciones de estaciones
compartidas son contratos ejecutables de fuente o de perfil con vinculaciones
(bindings) explícitas.

**Dónde leer más.** Los documentos detallados de
[contrato del lenguaje](LANGUAGE.es.md),
[superficie de control](LANGUAGE-SURFACE.es.md),
[reglas de la fuente literaria](LITERATE.es.md) y
[restricciones](CONSTRAINTS.es.md) separan la sintaxis elegida de las
propuestas de diseño. [Límites de la implementación](IMPLEMENTATION.es.md)
describe el subconjunto ejecutable que se conserva.

Las conversaciones privadas y los registros de tareas de migración se mantienen
fuera de esta exportación independiente de la fuente. Esta página solo contiene
el fundamento a nivel de lenguaje.
