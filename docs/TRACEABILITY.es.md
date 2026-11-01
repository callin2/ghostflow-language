<!-- translation-source: docs/TRACEABILITY.md -->
[Original en inglés](TRACEABILITY.md)

# Implementación y comprobaciones del lenguaje

Esta página relaciona cada contrato del lenguaje con el código que lo
implementa y con las pruebas que lo comprueban.

Solo le indica **dónde** se encuentran las pruebas conservadas. No le indica si
pasaron. Para ver qué comprobaciones se ejecutaron y pasaron, lea el
[informe de verificación](VERIFICATION.es.md) del checkout actual. Esta tabla
tampoco arrastra ninguna afirmación de finalización ni de hardware del espacio
de trabajo de origen.

| Contrato | Implementación | Verificación |
|---|---|---|
| Sintaxis de control moderna, tipos, reducción (lowering) | `tools/control.mjs`, `tools/gfb1.mjs` | `tests/control.test.mjs`, `tests/compiler.test.mjs` |
| Extracción literaria (literate) y posiciones originales | `tools/literate.mjs`, `tools/toolchain.mjs` | `tests/literate.test.mjs`, `tests/toolchain.test.mjs` |
| Semántica verificada de VM/estado/intención | `crates/ghostflow-core/src/lib.rs` | Pruebas unitarias de Rust, paridad nativo/WASM del tutorial |
| Entrada tipada del host y comprobaciones de manifiesto/hash | `runtimes/wasm/control-runtime.mjs` | `tests/control-host.test.mjs` |
| Acondicionamiento de sensores y señales | `signals.rs` del núcleo, ABI/adaptador de señales WASM | Pruebas de Rust, `tests/signals-wasm.test.mjs`, tutorial de humedad |
| Restricciones independientes y vinculación | `tools/constraints.mjs`, `runtimes/wasm/policy.mjs` | `tests/constraints.test.mjs`, `tests/policy.test.mjs` |
| Ocurrencias de programación e ID fijos | Adaptadores WASM de programación/admisión | `tests/schedule.test.mjs`, `tests/scheduled-admission.test.mjs` |
| Titularidad de estaciones, cuotas y persistencia | `station.rs` del núcleo, ABI de estaciones WASM, libro mayor (ledger) de Node | Pruebas de Rust, `tests/station-wasm.test.mjs`, `tests/ledger.test.mjs`, demo de estaciones |
| Misma traza de entrada generada en nativo/WASM | `tools/tutorial.mjs`, ejecutor nativo del núcleo | Aserciones del tutorial y trazas generadas |
| Identidad de versión frente a evidencia de ejecución | `tools/integration-contract.mjs`, `contracts/integration-v1` | `tests/integration-contract.test.mjs` (fixture ficticio) |

Dos tipos de comprobaciones se encuentran fuera de este repositorio:

- La procedencia de versiones entre proyectos y las comprobaciones de
  Device/API/frontend pertenecen a los proyectos de integración y consumidores.
- La tarea original y el historial de conversación permanecen en el espacio de
  trabajo privado de migración.
