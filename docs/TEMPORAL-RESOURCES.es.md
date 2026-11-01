<!-- translation-source: docs/TEMPORAL-RESOURCES.md -->
[Original en inglés](TEMPORAL-RESOURCES.md)

# Planificación de recursos temporales

La planificación de recursos temporales le indica, antes de comprometer
memoria, cuántos bytes necesitarán las funciones temporales (ventanas, muestras
retenidas, puntos de control, reproducción) en un destino determinado. La
planificación estática está disponible en el runtime nativo y en ambos
adaptadores WASM.

`GhostFlowRuntime` y `FramedGhostFlowRuntime` exponen dos llamadas síncronas:

- `planTemporal` planifica la ejecución en vivo. Funciona antes de la
  activación.
- `planTemporalReplay` planifica una reproducción (replay) (consulte
  [TEMPORAL-REPLAY.es.md](TEMPORAL-REPLAY.es.md)). Requiere una ejecución
  activa con registros retenidos elegibles.

```js
const plan = runtime.planTemporal({ profile, maxJsonBytes });
// After activation and successful ticks/scans:
const replayPlan = runtime.planTemporalReplay({ count, profile, maxJsonBytes });
const lastPlan = runtime.resourcePlan; // last successful report
```

Quien llama proporciona `profile`, `count` y `maxJsonBytes`. Esta página no
implica ninguna cadencia, densidad ni presupuesto predeterminados. La
planificación devuelve metadatos estáticos y acotados. No asigna áreas de
muestras temporales, de pruebas ni de puntos de control, y no ejecuta ningún
tick. La planificación de reproducción requiere una ejecución framed o legacy
activa con registros retenidos elegibles. `resourcePlan` es null hasta la
primera llamada de planificación exitosa.

**Informe del plan en vivo.** El formato es `GhostFlow/temporal-resources-v1`.
El informe incluye:

- la huella (fingerprint) y la estrategia del módulo instalado;
- el ancho de puntero del destino;
- la capacidad del registro (journal), el número de ventanas y las muestras
  retenidas;
- los bytes temporales contabilizados;
- `fitsBudget`.

Cómo se tratan los presupuestos y las entradas incorrectas:

- Un presupuesto positivo pero insuficiente devuelve `fitsBudget: false` y aun
  así informa las capacidades requeridas.
- Se rechazan los hechos no válidos y las vinculaciones de reproducción
  incompatibles.
- También se rechaza una geometría que desborde el rango de enteros verificado
  del destino. Nunca se hace que dé la vuelta (wrap) hasta un requisito menor.

**Qué cuenta `accountedTemporalBytes`.** Es una cota superior contabilizada y
específica del destino.

| Incluido | Excluido |
| --- | --- |
| anillos de densidad, observaciones retenidas, capacidad de prueba/marca de agua alta, bancos candidatos y consolidados, puntos de control, proyecciones, límites de traza/marcadores, espacio temporal de construcción, metadatos de plan superpuestos | metadatos del asignador, almacenamiento escalar/de módulo, salida JSON/de informe, copias de JavaScript propiedad de quien llama |

`targetPointerBytes` indica el ancho de diseño del destino usado en el cálculo.

**Informe del plan de reproducción.** El formato es
`GhostFlow/temporal-replay-resources-v1`. El informe incluye el número
elegible, el número solicitado, los bytes en vivo y ghost, las cabeceras de
retorno y de trama, los bytes temporales pico requeridos y `ghostFitsBudget`.
La suma de bytes cubre todo lo que existe al mismo tiempo: la geometría en vivo
y ghost, los registros del núcleo devueltos y los resultados de tramas. La
geometría ghost usa una capacidad de registro igual al número solicitado. El
presupuesto JSON de reproducción se acota de forma independiente del
presupuesto del área temporal.

**Reemplazo y rechazo.** Solo un plan exitoso reemplaza `resourcePlan`. Un
rechazo conserva el plan anterior, la reproducción anterior, la ejecución en
vivo, la secuencia de tramas y el resultado.

**Exportaciones WASM.** Los equivalentes WASM son `gf_plan_temporal`,
`gf_plan_temporal_replay`, `gf_frame_plan_temporal` y
`gf_frame_plan_temporal_replay`, cada uno con sus getters correspondientes de
puntero/longitud del plan de recursos. `maxJsonBytes` acota el búfer del plan
anterior más su candidato de reemplazo. El búfer del plan de recursos está
separado del búfer del resultado de reproducción.

**Alcance.** Este contrato cubre ventanas físicas medidas y derivadas. La
evidencia estimada, otros operadores temporales, los puntos de control ajenos y
las identidades completas de rama/cierre de fuentes de la Referencia §6.8 quedan
fuera de este contrato.
