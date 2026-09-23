# Reference simulator baseline — 2026-09-23

Run with:

```sh
node --test tests/reference-simulator.test.mjs
```

The accepted Reference catalog has 83 executable examples. Current result: 69
compile-and-run checks pass, 11 fail, and 3 standalone resource declarations
are inapplicable because they contain no control to scan. The 69 passes do not
establish Reference semantics for every case. Twelve cases have explicit
behavior oracles: `REF-01-057`, `REF-01-097`, `REF-03-015`, `REF-03-042`,
`REF-03-045`, `REF-04-020`, `REF-04-025`, `REF-04-027`, `REF-04-028`,
`REF-04-029`, `REF-04-035`, and `REF-04-041`. All twelve pass.

The suite is RED. Since `verify-language` runs this test, the full `npm test`
suite also fails until these gaps are resolved. No failures are skipped or
marked todo.

The 10 descriptor artifact failures are `REF-03-024`, `REF-03-032`,
`REF-03-036`, `REF-03-038`, `REF-03-050`, `REF-03-057`, `REF-03-059`,
`REF-03-060`, `REF-03-062`, and `REF-04-026`. These compile to schedule,
accounting, or temporal descriptors, which `ghostsim` cannot execute as control
artifacts. Each source contains a complete control program with outputs.

`REF-04-058` declares a continuous control objective, but its current GFB has
no executable controller or output. Accepting its `resources` manifest key
alone would produce a false success. The three inapplicable declarations are
`REF-04-044`, `REF-04-045`, and `REF-04-050`.

A pass means the accepted source compiles and the virtual scenario completes.
Assertions cover scan IDs and logical times, plus requested and safe virtual
intent. The simulator does not model physical I/O, applied output, or device
confirmation. Remaining work is executable integration for the ten complete
control programs emitted as descriptors and the continuous objective in
`REF-04-058`.
