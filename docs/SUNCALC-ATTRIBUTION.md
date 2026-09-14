# SunCalc attribution for the portable solar provider

`crates/ghostflow-core/src/solar.rs` is a dependency-free Rust port of the
sea-level sunrise/sunset calculation in [SunCalc 2.0.2](https://github.com/mourner/suncalc/tree/v2.0.2), specifically its `getTimes` path and its apparent-solar-coordinate helpers.
It retains the same `suncalc-2.0.2/sea-level` calculation identity used by the
existing JavaScript reference adapter. Moon calculations and mutable custom
time configuration are not ported.

Copyright (c) 2026, Volodymyr Agafonkin. Redistribution and use in source and
binary forms, with or without modification, are permitted subject to the
conditions in the upstream BSD 2-Clause license. The complete retained license
notice is below.

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

The checked-in vectors are verified by `cargo test`; optionally run
`GHOSTFLOW_SUNCALC_REFERENCE_DIR=/absolute/path/to/suncalc node tools/compare-solar-reference.mjs`
against an explicit local SunCalc 2.0.2 package to verify the fixture origin.
The script verifies that the JavaScript provider resolves to that exact package,
checks its package version, rejects non-finite results, and covers both preview
and polling fixtures.
