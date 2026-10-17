# Eventos PlayRiftbound en sitios comunitarios (2026-10-17)

Revisión de solo lectura de tres sitios públicos y sus bundles/respuestas HTTP.
Las capturas se hicieron el 17 de octubre de 2026 entre 08:41 y 08:46 UTC; no
se inició sesión ni se reproducen nombres o identidades personales en este
informe. Se analizaron campos estructurales de eventos y matches públicos.

## Hallazgos

| Sitio | Evidencia de PlayRiftbound | Resultado útil para `riftbot` | Frescura observada |
|---|---|---|---|
| [BoundRift](https://boundrift.com/events) | Catálogo y detalle de Play; también UVS, TopDeck y LoLTCG | Un evento Play terminado entrega fases, rondas, matches y standings. El ID local no es el ID Riot. | No hay marca de ingestión/actualización por evento en la respuesta. |
| [TCG2GO](https://tcg2go.io/events?source=official) | Lista combinada con `source: "rb"` para Riot/Play y `source: "uvs"` para UVS | Útil para descubrir eventos y contar registrados; el frontend reserva roster y standings para UVS. | No expone marca de actualización por fila. |
| [RiftIndex](https://riftindex.com/events) | Listado combinado con `source: "riot"` y `source: "uvs"` | Útil para descubrir eventos. El endpoint observado no contiene partidas ni standings. | Expone tiempos de actualización separados para Riot y UVS. |

## BoundRift: catálogo Play y matches normalizados

El bundle público [index-DnzatR_n.js](https://boundrift.com/assets/index-DnzatR_n.js)
llama a `GET /api/events`, `/api/events/upcoming`, `/api/events/:id`,
`/api/events/:id/matches?round_id=…` y
`/api/events/:id/standings?round_id=…`. El fragmento
[eventSource-C8raf4ig.js](https://boundrift.com/assets/eventSource-C8raf4ig.js)
separa las fuentes `playriftbound`, `uvs`, `topdeck` y `loltcg` y enlaza las
filas Play a la página de PlayRiftbound.

`GET /api/events/2120005716` devolvió `source: "playriftbound"` y el enlace
oficial al torneo Riot `117095965990633192`, “Presentación Radiance - La Cueva
Roja”. La respuesta marcaba `lifecycleStatus: "EVENT_FINISHED"`, 22 jugadores
registrados y empezados, una fase completa y cinco rondas completas. La quinta
ronda se pudo consultar con
[`/api/events/2120005716/matches?round_id=1200571605`](https://boundrift.com/api/events/2120005716/matches?round_id=1200571605)
y
[`/api/events/2120005716/standings?round_id=1200571605`](https://boundrift.com/api/events/2120005716/standings?round_id=1200571605).
El primero devolvió ocho matches; el segundo, 22 filas de standings. Las cinco
rondas juntas tuvieron 51 matches con estado `COMPLETE`.

El modelo normalizado de match contiene `winningPlayerId`, marcador de juegos,
`isBye` e `isIntentionalDraw`; no contiene `drawType` ni una señal de conflicto
entre reportes. En la quinta ronda, `round_id=1200571605`, tabla 1,
`matchId=1500106387` tenía `gamesDrawn: 1`, `winningPlayerId: null` y
`isIntentionalDraw: true`. Esa coincidencia se puede comprobar sin nombres:
evento Riot `117095965990633192` + ronda 5 + tabla 1.

La lectura directa del mismo evento en Play identificó el match Riot
`esportsMatchId=117451962559980400` en la tabla 1, con `status: IN_PROGRESS`,
`teamOutcomes: TIE` y un juego `TIE`. El `matchId` local de BoundRift no es el
`esportsMatchId` de Riot; la unión de esta muestra usa evento, ronda y mesa. La
consulta directa Play expone el empate, pero no su subtipo intencional, y la
ronda sí estaba finalizada. Por eso el `isIntentionalDraw: true` de BoundRift
demuestra lo que publica su normalizador, no que Riot entregue esa señal ni de
dónde procede la clasificación. El contrato GraphQL público consultado en
[la revisión de paridad](events-api-parity-gaps-2026-10.md) no incluye el campo
equivalente.

El detalle del evento no tenía `updatedAt`, `lastSeenAt` ni otra marca de
frescura. El header HTTP `Date` indica cuándo respondió BoundRift, no cuándo
obtuvo el dato de Play.

La interfaz reconoce `EVENT_CANCELLED` en el bundle de detalle, pero el evento
Play completado observado era `EVENT_FINISHED`; no se encontró en esta muestra
un torneo Play cancelado que permita confirmar qué devuelve la fuente.
Tampoco hay un campo de conflicto en las filas de matches examinadas. No se
debe inferir cancelación o conflicto de una búsqueda vacía.

La lista de jugadores que el usuario marca para seguimiento se guarda en el
navegador, bajo `localStorage["boundrift.eventTracker"]`, según el bundle
[eventTracker-D0qCh7Fg.js](https://boundrift.com/assets/eventTracker-D0qCh7Fg.js).
Es una preferencia local de interfaz, no una señal de Riot ni un endpoint de
watch que el bot pueda suscribir.

## TCG2GO: lista combinada, matches UVS

La publicación comunitaria de [levigeorge1617 en Reddit](https://www.reddit.com/r/riftboundtcg/comments/1wh1o9u/updated_event_locator_with_both_sites/)
enlaza a TCG2GO y explica que añadió eventos de Play junto a los de UVS. La
prueba primaria está en el frontend
[official-events.js](https://tcg2go.io/js/official-events.js): reconoce
`source === "rb"` para Play y `source === "uvs"` para UVS, construye los
enlaces de salida según esa fuente y consulta
`GET /events/api/official?latitude=…&longitude=…&start_date_after=…&start_date_before=…&num_miles=…`.

La consulta pública reproducible para Sevilla,
`https://tcg2go.io/events/api/official?latitude=37.3891&longitude=-5.9845&start_date_after=2026-10-16&start_date_before=2026-10-17&num_miles=15`,
respondió 18 eventos. Entre ellos estaban los IDs Play
`117093196872746571` y `117095965990633192`, ambos con `source: "rb"`, sus
enlaces de PlayRiftbound y `registered_user_count` de 8 y 22. El payload incluye
horario, estado mostrado, aforo, registrados y ubicación, pero no una marca
`updated_at` o `last_seen` por evento.

El mismo bundle comenta que los rosters, standings y el deep scrape se basan en
las tablas que solo llena el scrape UVS; esos controles son para eventos UVS.
Por tanto, el catálogo sí integra Play, pero la ruta examinada no ofrece
pairings Play. El frontend también mantiene tabs separados de “Official” y
“Community”; el comentario del autor en Reddit aclara que sus eventos
Community son creados dentro de TCG2GO, no eventos oficiales mezclados con Play.

## RiftIndex: ingestión con frescura por proveedor

El bundle de eventos
[0o7a.5zl_t0za.js](https://riftindex.com/_next/static/chunks/0o7a.5zl_t0za.js)
consulta `GET /api/events` con filtros y paginación. La respuesta pública de
[`/api/events?status=upcoming&page=1&page_size=25`](https://riftindex.com/api/events?status=upcoming&page=1&page_size=25)
devolvió 25 filas: 24 con `source: "riot"` y una con `source: "uvs"`. Las filas
incluyen `riot_id`, `riot_status`, `riot_last_seen_at` y
`riot_status_checked_at` cuando aplica. Son eventos para calendario: la
respuesta no incluye pairings, rondas o standings.

RiftIndex expone una marca separada en
[`/api/freshness`](https://riftindex.com/api/freshness). La captura respondió
`updated_at: 2026-10-17T08:40:21Z`, `uvs` con la misma hora y `riot:
2026-10-17T08:33:26Z`. Los timestamps por fila tienen semánticas distintas:
por ejemplo, una fila mostraba `updated_at` del 17 de octubre,
`riot_status_checked_at` del 17 de octubre y `riot_last_seen_at` del 9 de
octubre. Conviene usar `/api/freshness` para frescura global por proveedor y
`riot_last_seen_at` para saber cuándo se observó esa fila en Riot; no asumir
que cualquier `updated_at` significa una descarga nueva de Play.

La página HTML de eventos llegó con `Age: 607044` y caché Vercel `HIT`, pero
las dos consultas API anteriores llegaron con `Age: 0`/`MISS`. El TTL de la
página no describe la frescura de los datos que el frontend carga desde la
API.

## Implicación para `riftbot`

De estos sitios, BoundRift es la única muestra examinada que expone pairings y
standings para un evento Play completado. Su adaptador muestra una traducción
útil de los resultados, pero usa IDs locales y no declara cuándo refrescó cada
torneo. TCG2GO y RiftIndex corroboran que el nuevo catálogo puede combinarse
con UVS, aunque sus superficies examinadas no son fuentes de pairings Play.

Para `riftbot`, BoundRift sirve como comprobación externa de una muestra, no
como contrato canónico. Mantener Play como fuente de resultados, conservar
`drawType`/conflicto como desconocidos cuando el contrato directo no los
expone, y no tratar `EVENT_CANCELLED`, una fila ausente o el reloj HTTP de una
web comunitaria como prueba de cancelación o frescura Riot. Véase también
[Huecos de paridad del proveedor de eventos](events-api-parity-gaps-2026-10.md).
