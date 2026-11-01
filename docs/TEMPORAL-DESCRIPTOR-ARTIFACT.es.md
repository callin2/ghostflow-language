<!-- translation-source: docs/TEMPORAL-DESCRIPTOR-ARTIFACT.md -->
[Original en inglés](TEMPORAL-DESCRIPTOR-ARTIFACT.md)

# Artefactos temporales diferidos

Esta página explica qué produce el compilador para las declaraciones temporales
(dependientes del tiempo y de la naturaleza) y cuándo la salida **no** es
ejecutable.

**Condiciones naturales ejecutables.** Para condiciones naturales como
`tide_is` y `moon_is`, el compilador canónico de `.ghost.md` emite GFB11
ejecutable. El manifiesto `GhostFlow/control-v10` que lo acompaña conserva sus
descriptores de proveedor tipados. Compilar no basta para ejecutarlas:

- La activación en runtime requiere un perfil de contexto explícito que
  contenga las vinculaciones (bindings) de proveedor declaradas.
- Las observaciones del proveedor deben llevar evidencia de clasificación,
  cobertura, vencimiento, incertidumbre, ubicación/zona horaria y revisión.
- Quien llama no puede suministrar directamente proyecciones Result
  protegidas.

**Declaraciones `after_event` diferidas.** Una declaración `after_event` que no
se usa y no tiene proyección explícita permanece como un
`GhostFlow/temporal-descriptor-artifact-v1` verificado cuando su contrato de
ejecución no está disponible. Este artefacto JSON **no es bytecode GFB**. Tanto
su carga útil como su manifiesto acompañante declaran `executable: false`.

**Qué conserva el artefacto.** El artefacto conserva la fuente de control
extraída completa y los descriptores tipados. El sobre (envelope) normal del
documento fuente conserva el texto literario (literate) exacto, su SHA-256 y
las posiciones en la fuente. La verificación vuelve a compilar esa fuente
canónica. Rechaza bytes alterados, manifiestos de descriptores alterados e
identidades de fuente alteradas.

Para un descriptor diferido, `requiredRuntimeContracts` nombra el límite de
ejecución que falta:

- `identified-event-delivery` y `per-identity-result-projection`: identifican
  una declaración `after_event` no usada que no tiene proyección ejecutable.

`ControlRuntime` rechaza el manifiesto del descriptor diferido. También rechaza
un artefacto ejecutable de condición natural al que le falten la activación de
contexto o las vinculaciones de proveedor requeridas. La compilación por sí
sola no demuestra la conformidad del runtime ni el despliegue en un
dispositivo.

**Proyecciones `after_event` ejecutables.** La
[ABI WASM de after_event](AFTER-EVENT-WASM-ABI.es.md) ejecuta la entrega
identificada, los resultados nativos por identidad y las proyecciones
explícitas `after_event_any` y `after_event_all` en una única transacción de
control. Las fuentes que usan cualquiera de las dos proyecciones se compilan a
GFB ejecutable. El compilador nunca infiere una proyección para una señal
aislada o no usada.
