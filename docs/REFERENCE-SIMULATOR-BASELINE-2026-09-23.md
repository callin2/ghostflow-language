# Reference simulator baseline — 2026-09-23

Run with:

```sh
node --test tests/reference-simulator.test.mjs
```

The accepted Reference catalog has 83 executable examples. Current result: 62
compile-and-run smoke checks pass, 18 fail, and 3 standalone resource
declarations are inapplicable because they contain no control to scan. The 62
smoke passes do not establish Reference semantics. Only five cases have
explicit behavior oracles, and all five pass: `REF-01-057`,
`REF-01-097`, `REF-03-015`, `REF-04-020`, and `REF-04-041`.

The suite is RED. Since `verify-language` runs this test, the full `npm test`
suite also fails until these gaps are resolved. No failures are skipped or
marked todo.

The 10 descriptor artifact failures are `REF-03-024`, `REF-03-032`,
`REF-03-036`, `REF-03-038`, `REF-03-050`, `REF-03-057`, `REF-03-059`,
`REF-03-060`, `REF-03-062`, and `REF-04-026`. These compile to schedule,
accounting, or temporal descriptors, which `ghostsim` cannot execute as control
artifacts. Each source contains a complete control program with outputs.

The six temporal or Solar activation failures are `REF-03-042`, `REF-03-045`,
`REF-04-025`, `REF-04-027`, `REF-04-028`, and `REF-04-029`. Their activation
requires runtime bindings. `REF-04-035` requires a capability-aware adaptation
host. `REF-04-058` uses a manifest `resources` key that the simulator does not
support. The three inapplicable declarations are `REF-04-044`, `REF-04-045`,
and `REF-04-050`.

A pass means the accepted source compiles and the virtual scenario completes.
Assertions cover scan IDs and logical times, plus requested and safe virtual
intent. The simulator does not model physical I/O, applied output, or device
confirmation. Remaining work is simulator support for descriptor execution,
runtime-bound activation, capability-aware adaptation, and resource manifests.
