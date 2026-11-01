<!-- translation-source: examples/curriculum/pc-03-motor-contactor.ghost.en.md -->
[Original en inglés](pc-03-motor-contactor.ghost.en.md)
> Traducción de lectura. Para compilar, use el archivo original en coreano [`pc-03-motor-contactor.ghost.md`](pc-03-motor-contactor.ghost.md).

# PC-03 — Orden del contactor del motor y permiso de sobrecarga

<!-- ghostflow:anchor id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 kind=intent status=confirmed origin=imported -->
> Escenario de aprendizaje: agregue el permiso de la protección contra sobrecarga
> del motor al comportamiento de autorretención de PC-02. Este documento define un
> escenario de aprendizaje del currículo; no cita una declaración directa del usuario.

El original en coreano enlazado es la única fuente canónica, literate y ejecutable
de PC-03. Reutiliza el evento de arranque nuevo y la inhibición del rearranque de
PC-02, y mantiene intacto el ejemplo básico de autorretención de la lección
[E03](../../docs/ProgrammingInGhostflow.es.md#ch03).

`stop_ok` y `overload_ok` son entradas de permiso cuyo significado ya está
normalizado: `true` significa que la ruta de parada o la protección contra
sobrecarga permite la operación. El cableado NC y la polaridad de los contactos del
pulsador de parada real y del relé de sobrecarga pertenecen a la instalación
eléctrica y al adaptador del dispositivo. Este ejemplo de aprendizaje solo recibe
valores Bool.

Esta revisión explícita de entradas con calidad mantiene sin cambios la reproducción
(replay) con entradas sanas. Para los fallos de adquisición:

- Una solicitud START no disponible no puede arrancar ni rearmar el control. Una
  marcha existente puede continuar mientras STOP y la protección sigan sanos y
  permitan la operación.
- Una entrada STOP o de protección no disponible retira el permiso.
- Tras la recuperación, se requiere una liberación sana de START seguida de una
  nueva solicitud START.

La fuente anterior se conserva como historial no ejecutable en
`tests/fixtures/history/issue531/pc-03-motor-contactor.ghost.en.md.pre-input.txt`.

```ghost
// Source revision: issue531-approved-fault-restart-v1
control MotorContactor {
  input start, stop_ok, overload_ok: Bool;
  output motor_contactor: Bool;

  // ghostflow:link id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 relation=implements
  state armed: Bool = false;
  // ghostflow:link id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 relation=implements
  state running: Bool = false;

  let start_good = case start { ok(_) => true; fault(_) => false; };
  let start_value = start |> recover(false);
  let stop_ok_good = case stop_ok { ok(_) => true; fault(_) => false; };
  let stop_ok_value = stop_ok |> recover(false);
  let overload_ok_good = case overload_ok { ok(_) => true; fault(_) => false; };
  let overload_ok_value = overload_ok |> recover(false);

  let permit = stop_ok_value && overload_ok_value;
  let start_event = start_good && armed && start_value;

  running' = permit && (start_event || running);
  armed' = start_good && permit && !start_value;

  motor_contactor <- running';
}
```

`motor_contactor` es la orden lógica enviada a la bobina del MC (contactor
magnético). No demuestra que los contactos principales se hayan cerrado, que el
motor esté energizado ni que esté girando.

Si el relé de sobrecarga se dispara durante la operación (`overload_ok=false`), el
estado siguiente y la orden se apagan en el mismo tick. Cuando la protección se
recupera, mantener pulsado START no arma el control, por lo que el motor no
rearranca por sí solo. START debe liberarse y volver a pulsarse para permitir un
arranque nuevo.

En la instalación, los dos circuitos son:

- **Circuito principal:** la ruta de potencia desde el interruptor automático, a
  través de los contactos principales del MC y del relé de sobrecarga, hasta el motor.
- **Circuito de control:** la ruta que energiza la bobina del MC desde la
  alimentación de control, a través de los contactos de STOP y de la protección
  contra sobrecarga y de la rama de autorretención formada por START y un contacto
  auxiliar del MC.

Una orden de bobina por software no reemplaza las funciones eléctricas
independientes de protección contra sobrecorriente, de parada de emergencia ni de
protección.

Este ejemplo no tiene salida de alarma, latch/restablecimiento de fallos,
temporizador, retroalimentación de sensores, operación de hardware ni sintaxis nueva
de GhostFlow. Las etapas posteriores del currículo tratan esos temas por separado.

`tools/check-pc-03.mjs` produce evidencia de aprendizaje virtual/compilador/WASM con
el compilador actual y el runtime WASM existente. Su resultado no contiene evidencia
física sobre el relé, los contactos principales del MC, la alimentación del motor
ni la rotación del motor.
