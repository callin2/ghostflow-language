<!-- translation-source: examples/solar-live-config.ghost.en.md -->
[Original en inglés](solar-live-config.ghost.en.md)
> Traducción de lectura. Para compilar, use el archivo original en coreano [`solar-live-config.ghost.md`](solar-live-config.ghost.md).

# Permitir programaciones al amanecer mediante observaciones de ajustes compartidas

El amanecer es un evento calculado para la ubicación y la zona horaria
declaradas. El ajuste que permite su ejecución (`enabled`) es otra cosa: una
observación `Result` tipada e independiente. Este ejemplo virtual lee esa misma
observación en dos lugares: las salidas ordinarias y la condición `when` de la
programación del amanecer.

- Si el ajuste tiene un fallo, no se admite ningún evento de amanecer nuevo.
- Cuando el ajuste se recupera, ese momento pasa a ser una línea base. Un
  evento que ya ha pasado no se inicia.

Las salidas son intención solicitada. No establecen una operación física ni una
instalación.

```ghost
control SolarLiveConfig {
  config enabled: Bool = true { access = operator; }
  schedule dawn: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.978;
    at = sun`rise`;
    basis = pulse;
    when = case enabled { ok(v) => v; fault(_) => false; };
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output settings_ok, current_enabled, due: Bool;
  settings_ok <- case enabled { ok(_) => true; fault(_) => false; };
  current_enabled <- case enabled { ok(v) => v; fault(_) => false; };
  due <- dawn.due;
}
```

La ubicación, la zona horaria y la definición del evento están fijadas en el
programa. El host suministra los hechos de reloj y solares, además de
observaciones de ajustes autenticadas. Rust consolida conjuntamente los
`Result` de los ajustes y la admisión del evento. Cada ocurrencia se consume
una sola vez, y una evaluación rechazada revierte ambos.
