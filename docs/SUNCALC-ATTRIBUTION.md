# SunCalc attribution for the portable solar provider

`crates/ghostflow-core/src/solar.rs` is a Rust port of the sea-level
sunrise/sunset calculation in
[SunCalc 2.0.2](https://github.com/mourner/suncalc/tree/v2.0.2). It has no
dependencies.

What the port covers:

- **Ported:** SunCalc's `getTimes` path and its apparent-solar-coordinate
  helpers.
- **Not ported:** moon calculations and mutable custom time configuration.
- **Identity:** the port keeps the same `suncalc-2.0.2/sea-level` calculation
  identity that the existing JavaScript reference adapter uses.

Copyright (c) 2026, Volodymyr Agafonkin. Redistribution and use in source and
binary forms, with or without modification, are permitted subject to the
conditions in the upstream BSD 2-Clause license. The complete retained license
notice follows.

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

**Verifying the port.** `cargo test` verifies the checked-in test vectors.
Optionally, you can also verify where the fixtures came from. Run
`GHOSTFLOW_SUNCALC_REFERENCE_DIR=/absolute/path/to/suncalc node tools/compare-solar-reference.mjs`
with the variable pointing at an explicit local copy of the SunCalc 2.0.2
package. The script:

- checks that the JavaScript provider resolves to exactly that package;
- checks the package version;
- rejects non-finite results;
- covers both the preview and the polling fixtures.
