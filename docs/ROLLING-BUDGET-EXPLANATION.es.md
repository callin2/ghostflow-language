<!-- translation-source: docs/ROLLING-BUDGET-EXPLANATION.md -->
[Original en inglés](ROLLING-BUDGET-EXPLANATION.md)

# Explicación duradera del presupuesto móvil

Un **presupuesto móvil** limita cuánto tiempo puede estar un recurso en ON dentro
de una ventana de tiempo deslizante (por ejemplo, "como máximo 30s de tiempo en
ON en cualquier intervalo de 60s"). Cuando ese presupuesto deniega un arranque,
un operador o una herramienta necesita saber *por qué* y *cuándo* podría
permitirse. `explainRolling` responde a ambas preguntas sin cambiar nada.

**La llamada.** `AccountingRuntime.explainRolling({ nowMs, windowMs, limitMs, reserveMs })`
lee una cuenta `on_time` duradera vinculada a una fuente comprobada:

- La fuente canónica comprobada selecciona la única ventana móvil, el límite y la
  reserva propuesta. Si los argumentos no coinciden con la fuente, la llamada se
  rechaza.
- Las vinculaciones inmutables copiadas conservan esa política, aunque quien
  llama intente editar los metadatos públicos.

**El resultado** incluye:

- el SHA de la fuente canónica y el SHA del artefacto;
- la cuenta/el destino y el ID explícito del recurso del host;
- el instante de la consulta;
- la duración usada (la unión de los intervalos aplicados) y la duración de las
  reservas pendientes;
- el límite y la reserva propuesta;
- `blocked`, y `blockReason: 'rolling-budget'` cuando la solicitud se deniega;
- `nextReleaseMs` y `ledgerRevision`.

**La misma aritmética que la admisión.** El libro mayor (ledger) de Rust calcula
la misma unión de intervalos aplicados y los mismos cargos pendientes que usa la
admisión real `reserveRolling`, de modo que la parte de presupuesto de la
explicación coincide con esa decisión de admisión.

**Ejemplo resuelto.** Tome los intervalos aplicados [0,20s] y [10s,30s], una
ventana de 60s, un límite de 30s y una propuesta de 5s:

- A los 40s, la ventana es [-20s, 40s]. La unión de los intervalos es 30s, así
  que se han usado 30s. 30s + 5s supera el límite de 30s, por lo que la
  solicitud queda bloqueada.
- El primer instante admisible es 65s. Entonces la ventana es [5s, 65s], se han
  usado 25s y 25s + 5s cabe en el límite.
- A los 64,999s la solicitud todavía se rechaza; a los 65s puede reservar.

El diagrama de tiempos siguiente muestra los dos intervalos aplicados y las dos
ventanas.

![Intervalos aplicados [0,20s] y [10s,30s] con ventanas de 60s consultadas a los 40s (bloqueado) y a los 65s (admisible)](diagrams/rolling-budget-explanation/release-example.es.svg)

La consulta no modifica el libro mayor y no concede ningún arranque. Otros fallos
de admisión, como la capacidad o las identidades duplicadas, se mantienen
separados de esta explicación del presupuesto.

**Qué promete `nextReleaseMs`.** `nextReleaseMs` supone que no llega evidencia
nueva. Otras reglas:

- Las reservas pendientes siguen cargadas hasta que se liquidan o se cancelan
  explícitamente por identidad. El tiempo transcurrido o una animación de OFF no
  las liberan.
- Si esos cargos más la propuesta ya superan el límite, no se promete ninguna
  liberación basada en el tiempo.
- Si el presupuesto ya es admisible, `nextReleaseMs` también es null.
- La búsqueda acotada realiza como máximo 64 consultas de unión.
- Las marcas de tiempo se saturan en el máximo de u64 y nunca dan la vuelta.
- Una consulta anterior al final de cualquier intervalo almacenado devuelve
  Unknown, porque la evidencia con fecha futura no puede establecer un pronóstico
  decreciente.

**Unknown.** Unknown devuelve null. Esto incluye un estado sin inicializar o
corrupto y una mutación no reconocida (un cambio cuya persistencia aún no se ha
confirmado).

- Solo las revisiones persistidas exactas producen evidencia para la explicación.
- Los números de revisión son locales a un propietario activo. Tras una
  restauración, vuelven a empezar en la revisión cero.
- La recuperación reproduce la instantánea duradera y la fuente canónica. No
  depende de un contador de revisiones que sobreviva a los reinicios.

**Responsabilidades del host.** El host (anfitrión) aporta evidencia aplicada
validada, vinculaciones de recursos estables y una línea de tiempo monotónica
comparable y de confianza. Esta API no fabrica un reloj ni una revisión de
vinculación, y no autentica comprobantes físicos.

**Conformidad (REF-04-066).** REF-04-066 ejercita la denegación real del libro
mayor en WASM, los límites exactos de liberación, Unknown mientras hay una
persistencia pendiente, la restauración de instantáneas y la activación del
control. Un libro mayor de contexto independiente, restaurado desde la misma
instantánea, produce una observación real de salida OFF completada. Esa
observación no causa la denegación móvil y no reinicia su libro mayor. La
animación no es una entrada de la API de contabilización de uso.

**Alcance.** Esta es una proyección de contabilización de uso de referencia.
**No** es:

- verificación de cabinet-view en el frontend;
- integración automática con el arranque/corte de `on_time` compilado;
- despliegue de la API;
- certificación del medio de almacenamiento;
- validación del Device.

La exportación WASM añadida requiere recompilar el módulo WASM. Los formatos de
GFB y de instantánea del libro mayor no cambian.
