<!-- translation-source: examples/solar-watering.ghost.en.md -->
[Original en inglés](solar-watering.ghost.en.md)
> Traducción de lectura. Para compilar, use el archivo original en coreano [`solar-watering.ghost.md`](solar-watering.ghost.md).

# Riego sincronizado con el amanecer y el atardecer

Este ejemplo riega según el amanecer y el atardecer de cada día, usando las
**coordenadas de prueba** de Seúl. Para una instalación real, escriba las
coordenadas verificadas de la granja y su zona horaria.

El ejemplo usa una disposición 8DI/8RO (ocho entradas digitales, ocho salidas
de relé) y nombra los relés de la siguiente manera:

| Relé | Función | Se solicita |
|---|---|---|
| RO1 | Bomba | siempre que cualquiera de los pares esté en marcha |
| RO2, RO3 | Par de válvulas | juntas, durante 5 minutos, empezando 30 minutos después del amanecer |
| RO4, RO5 | Par de válvulas | juntas, durante 5 minutos, empezando 30 minutos antes del atardecer |
| RO6–RO8 | Sin uso | siempre apagados |

Este ejemplo acciona al mismo tiempo las dos válvulas de cada par. Si no está
claro si el usuario quiere un funcionamiento simultáneo o secuencial, aclárelo
antes de escribir el programa.

```ghost
control SolarWateringFixture {
  let duration = 5min;

  schedule dawn: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.9780;
    at = sun`rise + 30min`;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }

  schedule dusk: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.9780;
    at = sun`set - 30min`;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }

  input DI1, DI2, DI3, DI4, DI5, DI6, DI7, DI8: Bool;
  output RO1, RO2, RO3, RO4, RO5, RO6, RO7, RO8: Bool;

  state dawn_active: Bool = false;
  state dusk_active: Bool = false;
  timer dawn_elapsed = elapsed(dawn_active);
  timer dusk_elapsed = elapsed(dusk_active);

  dawn_active' = if dawn_active then dawn_elapsed < duration else dawn.due;
  dusk_active' = if dusk_active then dusk_elapsed < duration else dusk.due;

  RO1 <- dawn_active' || dusk_active';
  RO2 <- dawn_active';
  RO3 <- dawn_active';
  RO4 <- dusk_active';
  RO5 <- dusk_active';
  RO6 <- false;
  RO7 <- false;
  RO8 <- false;

  require RO1 => (RO2 || RO3 || RO4 || RO5);
}
```

`dawn_active` y `dusk_active` tienen cada uno su propio estado Bool y su propio
temporizador de tiempo transcurrido. Cuando el tratamiento `skip` de un evento
solar no fiable no genera ninguna señal de inicio nueva, la comprobación de
cinco minutos de tiempo transcurrido de cada marcha ya iniciada continúa de
todos modos.
