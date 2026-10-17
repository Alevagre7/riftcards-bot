# Inspección de webs comunitarias: Riftfound y Riftbound.org

Fecha de comprobación: 17 de octubre de 2026, con observaciones iniciales del día 16. Se inspeccionaron las webs en un navegador Chromium limpio mediante Playwright, sus respuestas de red y el JavaScript público. No se inició sesión, no se enviaron mensajes y no se modificaron eventos.

## Riftfound: calendario respaldado por una copia de los eventos

Fuentes primarias:

- [Web de Riftfound](https://www.riftfound.com/).
- [Frontend desplegado](https://www.riftfound.com/assets/index-CXKjktUv.js).
- [Ficha JSON del evento de Júpiter](https://www.riftfound.com/api/events/prb-117093196872746571).
- [Repositorio que enlaza la propia web](https://github.com/eric-maynard/riftfound).

### Peticiones observadas y funcionamiento

Al abrir el calendario en el navegador, el cliente pidió una única lista a su propio servidor:

```text
GET /api/events?calendarMode=true
    &startDateFrom=2026-09-27T00:00:00.000Z
    &startDateTo=2026-11-01T00:00:00.000Z
    &lat=37.7749&lng=-122.4194&radiusKm=40.2335
```

El calendario muestra el mes completo, filtra por fecha, distancia y tipo y usa la respuesta `data` de esa petición. El cliente no recorre `pagination.totalPages` en modo calendario: esto explica por qué el bot duplica eventos al paginar esa misma respuesta completa. El código desplegado llama a `dR({calendarMode: true, ...})` y consume `gn.data` directamente.

Al abrir `/events/prb-117093196872746571`, la única petición dinámica fue `GET /api/events/prb-117093196872746571`. La ficha muestra descripción/dirección/tipo y un enlace `View Original Event` a `/api/events/{id}/visit`. No cargó rondas, participantes, clasificaciones ni emparejamientos. No se observó polling en esa ficha durante la inspección.

El prefijo `prb-` identifica el evento Riot en el catálogo de Riftfound y su `url` conserva el ID original como texto en `playriftbound.com`. El repositorio y el scraper se analizan en el [informe de GitHub](community-github-events-2026-10.md).

### Diferencia real de frescura

Se consultaron la ficha de Riftfound y la operación pública de detalle Riot del mismo torneo en paralelo el 17 de octubre:

| Dato | Riftfound | Riot, consulta directa |
|---|---|---|
| Torneo | `prb-117093196872746571` | `117093196872746571` |
| Inscritos | 2 | 8, estado `REGISTERED` |
| Fecha del dato disponible | `scrapedAt = 2026-10-13T08:11:25.882Z` | `updatedAt = 2026-10-16T18:59:05.685688Z` |
| Fin del evento | `endDate = null` | `endsAt = 2026-10-17T15:00:00Z` |

No demuestra que todos los registros de Riftfound estén desactualizados. Sí demuestra que usar su copia para un aviso en directo podría omitir cambios en este evento. Para Watch, el detalle directo de Riot es la fuente comprobada; el agregador sirve como referencia de importación/calendario, no como sustituto de datos vivos.

## Riftbound.org: catálogo propio con historial diario y zona horaria

Fuentes primarias:

- [Buscador](https://riftbound.org/events).
- [Guía del propio sitio](https://riftbound.org/learn/events/finding-events).
- [Frontend de la lista](https://riftbound.org/build/assets/Index-G9JbgOFf.js).
- [Ficha inspeccionada](https://riftbound.org/events/117166852889000678/elduelista-presentacion-radiance-sabado).
- [Frontend de la ficha](https://riftbound.org/build/assets/Show-BGJ6yRoO.js).

### Datos y transporte observados

La página inicial llega renderizada por el servidor con una proyección JSON de Inertia/Vue. El navegador recibe `events`, `filters`, `place`, `options`, `page`, `pages` y `total`. El JavaScript cambia los filtros mediante `GET /events`; para el mapa pide `GET /events/pool?...` con `Accept: application/json`.

En la lista se observaron IDs de Riot como texto, `riot_url`, aforo, inscritos, plazas libres, precio y etiquetas de ocupación. También llegan `timezone`, `offset`, `local_date` y `local_time`, más dirección/coordenadas/zona de la tienda. Esto permite mostrar hora local sin obligar al navegador a adivinarla.

La muestra del 17 de octubre contenía:

```text
id:         117166852889000678
starts_at:  2026-10-17T07:00:00+00:00
timezone:   Europe/Madrid
local_time: 09:00
offset:     +02:00
registered: 0
capacity:   32
```

La ficha añade descripción, apertura/cierre de inscripción, estructura, número de rondas configuradas, BO1/BO3, waitlist, `removed`, `past`, `details_fetched`, `last_seen` y una URL de calendario ICS. Su `history` contenía nueve puntos con `date` y `registered`: es una serie de ocupación diaria, no un roster de nueve jugadores.

En esta muestra, `last_seen` era `2026-10-17T05:35:30+00:00`, `removed=false` y `details_fetched=true`. La consulta directa a Riot confirmó el mismo ID y ausencia de inscritos (`registrantCounts: []`). En esa ficha no se recibieron matches, roster, standings ni peticiones directas de GraphQL desde el navegador.

No se ha inspeccionado el servidor de Riftbound.org: que entregue zona horaria e historial no demuestra de dónde los calcula, con qué librería ni cada cuánto actualiza todos los eventos. Solo se verificó su proyección pública y el comportamiento del frontend.

### Cómo distingue retirada y cancelación

La ficha usa `removed` para presentar esta advertencia en el JavaScript desplegado:

> This event is no longer listed. It may have been cancelled or moved.

No afirma que se haya cancelado: distingue una observación de disponibilidad de su posible causa. El campo `past` produce un mensaje diferente sobre un evento ya celebrado. Este patrón confirma una forma honesta de presentar eventos retirados; no aporta una señal oficial `CANCELLED` que pueda copiarse al watcher.

El campo `rounds` de la ficha es el número configurado, no la colección de rondas con sus partidos. No se encontró aquí una implementación alternativa de notificaciones de mesa/rival/resultado.

## Consecuencia para riftbot

1. Importar un calendario y seguir un jugador en directo requieren datos y frecuencias diferentes. No confundir la existencia de una web de eventos con una implementación de Watch.
2. El listado de Riftfound muestra cómo consumir `calendarMode` sin duplicar páginas y conservar el enlace/ID de origen; su copia no reemplaza el detalle vivo de Riot.
3. Riftbound.org demuestra una proyección útil de zona horaria, ocupación diaria y estado retirado. Puede servir de referencia de presentación, pero su frontend no revela un origen alternativo para conflictos, empates intencionales o cancelación explícita.
4. La arquitectura recomendada sigue siendo Riot directo para el bundle de torneo/Watch, con IDs de texto y caché breve controlada. Un catálogo cacheado puede complementar búsquedas, sin convertir datos antiguos en estado actual.
