<!-- translation-source: docs/TESTING.md -->
[Original en inglés](TESTING.md)

# Pruebas de conformidad y fiabilidad de GhostFlow

Estado: política de pruebas normativa.

Una ejecución exitosa de la suite actual es evidencia solo de los requisitos y
las configuraciones que esa ejecución nombra. **No** afirma que todo el
lenguaje, ni un Farm Device físico, esté verificado.

## Principios inspirados en SQLite

GhostFlow adopta las partes de la disciplina de pruebas de SQLite que encajan
con un lenguaje de control pequeño y portable:

1. **Toda afirmación normativa comprobable es un requisito.** Cada requisito
   tiene un ID estable derivado de su contenido y una ubicación exacta en la
   fuente. Tiene pruebas ejecutables o bien un motivo explícito de pendiente.
2. **Pruebe la interfaz publicada y los bytes desplegados.** Las pruebas solo
   del analizador o a nivel de fuente no pueden establecer el comportamiento de
   GFB, del runtime nativo ni de WASM.
3. **Mantenga arneses independientes.** Las pruebas del compilador, las del
   cargador/verificador de GFB, la ejecución nativa, la ejecución WASM y las
   pruebas del ciclo de vida del host deben poder discrepar entre sí.
4. **Ejercite ambos lados de cada límite y de cada decisión booleana.** Los
   límites declarados necesitan casos de mínimo, máximo, justo dentro y justo
   fuera.
5. **Inyecte fallos en cada límite atómico.** Compruebe el invariante tras cada
   fallo. Una compilación, carga, tick, reinicio, intercambio en caliente
   (hot-swap) o acción de persistencia rechazados no deben consolidar
   silenciosamente un estado parcial ni un conjunto parcial de salidas.
6. **Trate los artefactos malformados y mutados como entradas hostiles
   ordinarias.** El cargador debe rechazarlos sin entrar en pánico, o bien
   aceptarlos como un módulo válido por separado. Nunca suponga que una
   mutación equivale a su fuente.
7. **Compare implementaciones o destinos independientes** usando el mismo
   artefacto y la misma traza de entrada. Nativo y WASM deben coincidir. Como
   ambos destinos comparten la semántica del mismo núcleo, sigue siendo
   necesario un oráculo separado para esa semántica compartida.
8. **Mida las propias pruebas.** La cobertura de ramas/condiciones y las
   pruebas de mutación se convierten en puertas de publicación una vez que sus
   comandos reproducibles y sus exclusiones justificadas estén en el
   repositorio. Nunca infiera un porcentaje de cobertura a partir de un número
   de pruebas.
9. **Todo defecto corregido recibe una prueba de regresión.** Se requiere un
   caso de regresión mínimo y permanente antes de aceptar la corrección.
10. **Ejecute la suite de publicación sobre compilaciones de publicación.** Use
    artefactos en modo release y la misma configuración de características que
    despliegan los consumidores.

Esta política se inspira en las descripciones públicas de SQLite sobre su
catálogo de requisitos, las pruebas TH3 tal como se despliega, los bucles de
límites e inyección de fallos, las comparaciones independientes de SQL Logic
Test, la cobertura de ramas/MC/DC y las pruebas de mutación. No afirma que
GhostFlow haya alcanzado el nivel de cobertura o de garantía de SQLite.

Referencias:

- <https://www.sqlite.org/requirements.html>
- <https://www.sqlite.org/testing.html>
- <https://www.sqlite.org/th3.html>

## Registro de requisitos

El catálogo verificado por máquina en `contracts/requirements/` registra, para
cada requisito:

- un ID estable derivado del texto normativo normalizado;
- el texto normativo exacto y su localizador en la documentación;
- la capa propietaria y los destinos admitidos;
- los ID de las pruebas que ejercitan la afirmación, o un motivo de pendiente
  no vacío;
- un estado que distingue el trabajo verificado, parcialmente verificado y
  pendiente.

Cambiar el texto normativo crea un ID nuevo. El registro anterior sigue
disponible como historial reemplazado. De este modo, lo que demostró una prueba
antigua nunca cambia silenciosamente.

## Capas de verificación

Cada capa necesita su propia evidencia. La tabla enumera el mínimo para cada
una.

| Capa | Evidencia mínima |
| --- | --- |
| Gramática | casos de token/AST aceptados y rechazados con diagnósticos exactos |
| Tipos y reducción (lowering) | de fuente tipada a estructura GFB y manifiesto inspeccionados |
| Verificador GFB | secuencias de bytes válidas, truncadas, por encima del límite y mutadas |
| VM nativa | traza exacta de estado, intención solicitada, intención segura, fallo y atomicidad |
| VM WASM | el mismo artefacto/traza y la misma clase de error que en nativo |
| Ciclo de vida del host | instalación, activación, primer escaneo, escaneo fallido, reinicio, intercambio en caliente y reproducción |
| Adaptador de producto | solo artefacto de lenguaje identificado; sin evaluador duplicado |
| Dispositivo | puertas separadas de compilación, placa/perfil, driver y observación física |

## Regla de seguridad de salidas

**Qué es una declaración de salida.** Una declaración de salida nombra y tipa
un puerto lógico de intención. No guarda estado. No configura el nivel de
arranque ni el nivel a prueba de fallos (fail-safe) de un relé físico. Cada
salida declarada tiene exactamente una expresión de conexión por escaneo. Para
emitir una intención constante, escriba una expresión de conexión constante.

**Antes del primer escaneo exitoso.** Todavía no existe intención de salida de
la VM. El host/renderizador debe mantener su estado seguro configurado; la
política predeterminada de Farm Device es OFF. Un fallo de compilación, carga,
activación o tick no puede inventar una intención a partir de la sintaxis de la
fuente.

**Quién es responsable de la seguridad física.** Las políticas físicas de
arranque, watchdog y a prueba de fallos pertenecen a la vinculación (binding)
de host identificada. Permanecen separadas del programa portable de la VM.
