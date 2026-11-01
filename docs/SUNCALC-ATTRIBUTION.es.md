<!-- translation-source: docs/SUNCALC-ATTRIBUTION.md -->
[Original en inglés](SUNCALC-ATTRIBUTION.md)

# Atribución de SunCalc para el proveedor solar portable

`crates/ghostflow-core/src/solar.rs` es una adaptación a Rust del cálculo de
amanecer/atardecer a nivel del mar de
[SunCalc 2.0.2](https://github.com/mourner/suncalc/tree/v2.0.2). No tiene
dependencias.

Qué cubre la adaptación:

- **Adaptado:** la ruta `getTimes` de SunCalc y sus funciones auxiliares de
  coordenadas solares aparentes.
- **No adaptado:** los cálculos lunares y la configuración personalizada y
  mutable de horas.
- **Identidad:** la adaptación conserva la misma identidad de cálculo
  `suncalc-2.0.2/sea-level` que usa el adaptador de referencia JavaScript
  existente.

Copyright (c) 2026, Volodymyr Agafonkin. Se permiten la redistribución y el uso
en forma de código fuente y binaria, con o sin modificaciones, sujetos a las
condiciones de la licencia BSD de 2 cláusulas original. A continuación se
reproduce el aviso de licencia completo conservado, sin traducir.

```text
Copyright (c) 2026, Volodymyr Agafonkin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of
   conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list
   of conditions and the following disclaimer in the documentation and/or other materials
   provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

**Verificación de la adaptación.** `cargo test` verifica los vectores de prueba
incluidos en el repositorio. Opcionalmente, también puede verificar de dónde
provienen los fixtures. Ejecute
`GHOSTFLOW_SUNCALC_REFERENCE_DIR=/absolute/path/to/suncalc node tools/compare-solar-reference.mjs`
con la variable apuntando a una copia local explícita del paquete SunCalc
2.0.2. El script:

- comprueba que el proveedor JavaScript se resuelva exactamente a ese paquete;
- comprueba la versión del paquete;
- rechaza resultados no finitos;
- cubre tanto los fixtures de vista previa como los de sondeo (polling).
