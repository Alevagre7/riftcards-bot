# Implementaciones comunitarias de PlayRiftbound encontradas en GitHub (2026-10-17)

Este informe responde a la búsqueda de implementaciones públicas que ya consumen
la nueva plataforma de eventos de Riot. Se revisaron búsquedas de GitHub para
`playriftbound.com`, `CompeteTournamentSearch`,
`GetCompeteTournamentForRiftboundPlayer`, `GetCompeteRbRefreshPoller`,
`SubmitGameResults`, `playriftbound-ops.json` y `riftbound watcher`, y se
inspeccionaron archivos en commits concretos. No se ejecutó código de terceros
ni se accedió a cuentas o sesiones de Riot.

La búsqueda encontró tres implementaciones útiles y dos mecanismos auxiliares:

| Proyecto | Qué implementa | Evidencia revisada | Licencia en GitHub al 2026-10-17 |
|---|---|---|---|
| [riftfound](https://github.com/eric-maynard/riftfound/tree/d798ef93d5438c8284029254167cc36a37ac9562) | Ingesta programada de listados públicos a gran escala | Cliente TypeScript, pruebas y despliegue descrito en el [PR #4](https://github.com/eric-maynard/riftfound/pull/4) | [Apache-2.0](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/LICENSE) |
| [joutes-app](https://github.com/Nakasar/joutes-app/tree/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b) | Consulta y sincronización de eventos para una tienda | Cliente TypeScript, pruebas y [guía de fuente](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/docs/EVENT_SOURCES.md) | GitHub no detecta licencia |
| [Riftbound-Consort](https://github.com/Okay-U/Riftbound-Consort/tree/e2724863332cbe1fa01eb76b7060c82c270574d5) | Cliente de jugador: eventos propios, detalle, rondas, emparejamientos y resultados | Cliente Swift, modelos y refresh del Scoreboard con sesión del jugador | GitHub no detecta licencia |
| [riftbound_watcher](https://github.com/cafe-auvers/riftbound_watcher/tree/466b4277df6b0ddebebaef4d7c338f270463d7d8) | Alertas de cambios en el catálogo público y aforo | Playwright sobre la web, diferencias con `state.json`, mensajes por KakaoTalk | GitHub no detecta licencia |
| [okay-u.github.io](https://github.com/Okay-U/okay-u.github.io/tree/b476887ff966e184b725c8e11b6ae0799fabff45) | Descubrimiento y publicación de IDs de operaciones persistidas | Script extractor y snapshot JSON actualizado el 2026-10-16 | GitHub no detecta licencia |
| [rift-reports](https://github.com/shsshs010607-del/rift-reports/tree/32bb2abe039dfeff09cd6b7a39fe08a392dd94a7) | Importación de una instantánea coreana | Script de seed desde JSON; no contiene cliente GraphQL en vivo | GitHub no detecta licencia |

### Qué es live y qué queda cacheado

- `riftfound` recorre el buscador GraphQL en una tarea programada y persiste un
  catálogo en DynamoDB. Sus docs específicas y Terraform dicen cada dos horas;
  el README raíz aún dice cada hora, así que el código no confirma la frecuencia
  desplegada ([Terraform, líneas 336–361](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/infrastructure/terraform/serverless.tf#L336-L361);
  [README raíz, líneas 78–94](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/README.md#L78-L94)).
- Joutes consulta Play cuando refresca una fuente de tienda y guarda la
  reconciliación en su base de datos; un fallo de una fuente se conserva como
  fallo, no como lista vacía ([`refresh-events.ts`, líneas 139–180](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/lib/services/refresh-events.ts#L139-L180)).
- `riftbound_watcher` lee el DOM del buscador cada 15 minutos y compara el nuevo
  listado con `state.json`. Eso vigila anuncios y cupos, no emparejamientos.
- Consort obtiene el torneo del jugador con su propia sesión cuando la interfaz
  pide refrescar; 45 segundos es una espera mínima entre llamadas, no una tarea
  periódica. El flujo actual consulta `PlayerTournaments` y el detalle; la
  operación de poller no tiene un call site en el MatchStore.

GitHub detecta Apache-2.0 en `riftfound`; para Joutes, Consort, el watcher y los
repositorios auxiliares, `licenseInfo` aparece vacío en la revisión. Esa lectura
del metadato no sustituye una revisión legal, pero sí separa la licencia
explícita de las referencias técnicas sin licencia detectada.

## 1. Riftfound: la implementación más completa para listados públicos

El archivo [scraper/src/sources/playriftbound.ts](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts)
es una fuente real del scraper. Usa `CompeteTournamentSearch` con query
persistida, cabeceras de cliente Apollo y el endpoint
`https://events.playriftbound.com/api/gql` ([líneas 34–50](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L34-L50)).
La respuesta que normaliza contiene torneo, organizador, dirección, coordenadas,
fecha, tipo, precio, inscritos y capacidad ([líneas 232–277](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L232-L277)).

Esta es una ingestión programada que deja un catálogo persistido, no una llamada
directa por cada consulta de usuario. El Terraform configura EventBridge a dos
horas y la documentación específica describe una Lambda que escribe en DynamoDB;
el README raíz aún dice cada hora, así que esos archivos no permiten confirmar
qué frecuencia está desplegada ([`scraper/CLAUDE.md`, líneas 141–157](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/CLAUDE.md#L141-L157);
[Terraform, líneas 336–361](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/infrastructure/terraform/serverless.tf#L336-L361);
[README raíz, líneas 78–94](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/README.md#L78-L94)).
Cada ejecución barre una ventana rotatoria de anclas, por lo que puede ser parcial
y el catálogo puede reflejar datos de varias horas atrás ([rotación de anclas,
líneas 195–225](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L195-L225)).

### Cobertura geográfica

La operación `CompeteTournamentSearch` revisada requiere coordenadas y no expone
un parámetro de consulta global. La documentación de Riftfound afirma, a partir
de sus pruebas, que el servidor limita silenciosamente el radio a unos 161 km;
este informe no verificó ese límite de forma independiente ([`scraper/CLAUDE.md`,
líneas 79–95](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/CLAUDE.md#L79-L95)).
Riftfound resuelve esta cobertura en dos capas:

1. Convierte las coordenadas conocidas a celdas geohash de precisión 3 y usa el
   centro de cada celda como ancla ([líneas 164–193](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L164-L193)).
2. Barre una ventana rotatoria de anclas por ejecución; una pasada diaria cubre
   todas las celdas sin guardar un contador persistente ([líneas 195–225](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L195-L225)).

Cada consulta pide 120 km, pagina con cursores y deduplica por el ID de torneo.
El código limita páginas, respeta un plazo de ejecución y separa anclas
completadas de anclas parciales ([líneas 611–637](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L611-L637);
[líneas 697–869](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L697-L869)).

Para `riftbot`, esta estrategia solo es necesaria si el producto debe descubrir
eventos a escala global. Para el `/events` centrado en una ubicación del usuario
puede bastar una consulta por coordenadas, pero hay que respetar el límite de
radio y la paginación.

### Rotación de hashes y errores

La implementación tiene un hash por defecto y, si Riot lo rechaza, descubre el
hash actual leyendo el manifiesto Apollo. Si el chunk conocido deja de existir,
lee la página de eventos, sigue referencias a otros chunks y busca la entrada de
`CompeteTournamentSearch` ([líneas 327–435](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L327-L435)).
Ante 429, 403 o 5xx se detiene y retrocede; no sigue golpeando la API
([líneas 639–687](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L639-L687)).

El [PR #4](https://github.com/eric-maynard/riftfound/pull/4) documenta además
que la integración se probó con un hash deliberadamente incorrecto y se recuperó
desde el manifiesto. El mecanismo es valioso para `riftbot`, aunque conviene
centralizar los IDs y registrar la versión de la aplicación para poder actualizar
el mapper cuando cambien los campos, no solo el hash.

### Normalización y límites

Riftfound:

- prefija los IDs de Riot con `prb-` y convierte el UUID del organizador en un
  ID numérico reservado para su tabla de tiendas ([líneas 86–99](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L86-L99);
  [líneas 512–524](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L512-L524));
- normaliza país, precio, capacidad, inscritos y tipos de torneo; el tipo
  desconocido cae a `Other` ([líneas 441–510](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L441-L510));
- descarta un evento sin coordenadas, por lo que un adapter de `riftbot` debe
  tratar la ausencia de dirección como dato incompleto, no como evento inexistente
  ([líneas 543–605](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/sources/playriftbound.ts#L543-L605));
- sanitiza nombres y títulos antes de guardar. Sus tests fijan un payload `<script>`
  que apareció en datos reales ([tests, líneas 332–381](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/__tests__/playriftbound.test.ts#L332-L381)).

### Qué no resuelve

Riftfound no reemplaza toda la integración. El [entrypoint del scraper](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/index.ts#L224-L291)
lo trata como **segunda fuente** junto a UVS, hace deduplicación por ubicación y
hora y conserva el registro UVS cuando ambos coinciden. El propio README lo
describe como dos fuentes ([líneas 79–85](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/README.md#L79-L85)).

Solo implementa el buscador público. No contiene un adapter de detalle de torneo
con rondas, roster, rival o standings, ni un watcher de jugador. Por tanto, no
puede copiarse como solución completa para `/watch` o `/mytable`.

Su limpieza de eventos es una referencia importante: como barre anclas en lotes,
un evento ausente en una ejecución no se considera cancelado; protege los IDs
`prb-` de la limpieza hasta que hay evidencia suficiente ([líneas 322–337](https://github.com/eric-maynard/riftfound/blob/d798ef93d5438c8284029254167cc36a37ac9562/scraper/src/index.ts#L322-L337)).

## 2. Joutes: importación por tienda y reconciliación segura

El [PR #354](https://github.com/Nakasar/joutes-app/pull/354) está fusionado y
describe una lectura real de una tienda. Su código está en
[lib/events/riftbound-source.ts](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/lib/events/riftbound-source.ts).

### Flujo que implementa

Joutes no intenta descubrir todos los eventos del mundo. El administrador o la
tienda pega un enlace de un evento; el código consulta
`GetCompeteTournamentForRiftboundPlayer` para obtener el `organizerId`, consulta
`OrganizerSummary` para obtener dirección y coordenadas, y hace una búsqueda de
500 m con `CompeteTournamentSearch`. Como el radio trae tiendas vecinas, filtra
por el UUID del organizador ([documentación, líneas 237–275](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/docs/EVENT_SOURCES.md#L237-L275);
 [fuente, líneas 215–283](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/lib/events/riftbound-source.ts#L215-L283);
 [extracción, líneas 307–375](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/lib/events/riftbound-source.ts#L307-L375)).

La fuente fija las tres operaciones, construye el cuerpo con
`extensions.persistedQuery`, usa `sport: "rb"`, cursor y `startDate`, y añade las
cabeceras Apollo ([líneas 41–123](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/lib/events/riftbound-source.ts#L41-L123)).
Conserva los IDs grandes como texto y construye enlaces públicos con el ID del
torneo ([líneas 126–187](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/lib/events/riftbound-source.ts#L126-L187)).

El mapper cubre nombre, fecha UTC, precio gratuito o en euros, capacidad,
inscritos, estado de lleno y enlace al evento. No inventa una fecha final y deja
vacío el precio cuando la moneda no es EUR ([líneas 398–418](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/lib/events/riftbound-source.ts#L398-L418)).

### Protección contra borrados falsos

La arquitectura devuelve por cada fuente `ok`, error, warnings y eventos. Si una
fuente falla, sus filas se dejan intactas; si todas fallan, no se ejecuta la
reconciliación destructiva ([refresh-events.ts, líneas 139–180](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/lib/services/refresh-events.ts#L139-L180)).
La reconciliación recibe explícitamente `failedSourceUrls` y no elimina ni
marca filas de una fuente que no pudo leerse ([source-events.ts, líneas 539–617](https://github.com/Nakasar/joutes-app/blob/b08e53edfa046f92ae1bbbac0c2bb9ad2a510d8b/lib/events/source-events.ts#L539-L617)).

Este patrón debe trasladarse a `riftbot`: un `PERSISTED_QUERY_NOT_IN_LIST`, 429,
timeout o respuesta de schema no puede interpretarse como una lista vacía ni
cancelar watches. La ausencia real de un evento necesita una política de varias
lecturas válidas, y en una búsqueda parcial por radio debe protegerse lo que no
se ha consultado.

### Qué no resuelve

Joutes es un importador de agenda por organizador. No implementa `Watch`, lectura
de emparejamientos, notificaciones de ronda, standings ni reporte de resultados.
La operación de detalle se usa para resolver el organizador, no para consumir el
bracket completo.

## 3. Riftbound Consort: referencia para Watch y el modelo completo

El repositorio [Riftbound-Consort](https://github.com/Okay-U/Riftbound-Consort/tree/e2724863332cbe1fa01eb76b7060c82c270574d5)
es la evidencia comunitaria más útil para las funciones que faltan en
`riftbot`. Es una app Swift de jugador, no un bot, y su código usa una sesión
Riot del propio jugador.

### Operaciones y transporte

`PlayRiftboundAPI.swift` mantiene IDs persistidos incorporados y permite
actualizarlos una vez desde `playriftbound-ops.json` ([líneas 38–93](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundAPI.swift#L38-L93)).
El repositorio dice que Riot aprobó por escrito tres operaciones para su cliente
con sesión —`PlayerTournaments`, detalle del torneo y `SubmitGameResults`—, pero
la aprobación no está publicada para verificarla independientemente
([`docs/PLAYRIFTBOUND.md`, líneas 18–21](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/docs/PLAYRIFTBOUND.md#L18-L21)).
El código separa búsqueda, favoritos y registro/drop como operaciones fuera de
ese alcance declarado ([`PlayRiftboundFeatures.swift`, líneas 5–10](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundFeatures.swift#L5-L10)).

El cliente usa estas operaciones:

- `PlayerTournaments` para upcoming y past del jugador;
- `GetCompeteTournamentForRiftboundPlayer` para el torneo completo;
- `SubmitGameResults` para informar las partidas;
- guarda también el ID de `GetCompeteRbRefreshPoller`, pero el flujo actual del
  Scoreboard no lo consulta;
- declara además IDs para búsqueda, registro, drop, favoritos y `OrganizerSummary`.

Las queries persistidas viajan por GET con `operationName`, `variables` y
`extensions.persistedQuery`; las mutaciones viajan por POST con `Origin` del
sitio ([líneas 167–205](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundAPI.swift#L167-L205)).
El cliente envía `Content-Type`, `Accept` y las cabeceras Apollo, y clasifica
401/403, sesión caducada, errores GraphQL y hashes obsoletos ([líneas 227–268](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundAPI.swift#L227-L268)).

La autenticación no se puede tratar como una preferencia local del bot: Consort
lee las cookies de la sesión iniciada en el webview del sitio, calcula la
caducidad del JWT y refresca la página cuando hace falta ([PlayRiftboundSession.swift, líneas 14–24](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundSession.swift#L14-L24);
 [líneas 46–105](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundSession.swift#L46-L105)).
El código solo llama esas operaciones de jugador al entregar las cookies y el
token de la sesión abierta en el webview. Por tanto, el Watch de Consort es un
flujo con sesión del propio jugador, no un endpoint de búsqueda global por
nombre.

### Modelo de torneo y Watch

`CompeteModels.swift` modela la jerarquía completa:

```text
tournament
└── stages[]
    └── sections[]
        └── rounds[]
            ├── matches[]
            │   ├── teams[] / players[]
            │   ├── games[] / teamOutcomes[]
            │   └── teamOutcomes[]
            └── endOfRoundStandings[]
```

El modelo conserva `byeTeamIds`, `droppedTeamIds`, participantes, inscritos,
seeds, estados, W/L/D, puntos y porcentajes de desempate ([CompeteModels.swift,
líneas 120–305](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/CompeteModels.swift#L120-L305)).
Los identificadores son `String`, incluidos torneo, fase, sección, match, team,
player y game.

`CompetePairing.resolve` demuestra cómo derivar el emparejamiento del jugador:

- obtiene el team del jugador por su ID;
- ordena los `esportsMatchId` para reproducir el número de mesa, porque la API
  no expone un campo de mesa;
- distingue bye de emparejamiento;
- obtiene rival, game IDs, participant IDs y best-of;
- cuenta victorias por `game.teamOutcomes` y deriva el resultado desde
  `match.teamOutcomes` ([líneas 344–438](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/CompeteModels.swift#L344-L438)).

`PlayRiftboundMatchStore.refresh()` toma el próximo torneo registrado del jugador
que empieza antes de tres horas, trae el detalle y mantiene el último estado si
falla la red ([`PlayRiftboundMatchStore.swift`, líneas 39–93](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundMatchStore.swift#L39-L93)).
El método impone un intervalo mínimo de 45 segundos entre llamadas, pero no
agenda por sí mismo un bucle de polling. La interfaz lo llama al abrir el
Scoreboard, al volver la app al primer plano, al volver a la pestaña y mediante
un botón manual ([`ScoreboardView.swift`, líneas 122–157 y 386–388](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/ScoreboardView.swift#L122-L157)).
Aunque `GetCompeteRbRefreshPoller` aparece en la tabla de IDs, no encontramos
una llamada a esa operación en este flujo; no se debe describirla como una
parte implementada del Watch actual. Esta lógica sirve de referencia para el
mapper de pairings y para conservar snapshots ante errores, pero no sustituye
la sesión autenticada que `riftbot` no tiene.

### Rondas, standings, roster y resultado

La vista de rondas muestra el emparejamiento actual, historial, bye, reloj,
posición final y reportabilidad ([PlayRiftboundEventRoundsView.swift, líneas 14–59](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundEventRoundsView.swift#L14-L59)).
La vista de standings usa rank, W/L/D, puntos, OMW%, GW% y OGW%, y separa
participantes retirados ([PlayRiftboundEventStandingsView.swift, líneas 67–177](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundEventStandingsView.swift#L67-L177)).
El roster separa activos y retirados con `tournamentParticipants.status`
([mismo archivo, líneas 185–233](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundEventStandingsView.swift#L185-L233)).

El reporte de resultado usa `SubmitGameResultsInput` con el ID del torneo, cada
`esportsGameId`, `draw` y `winnerParticipantId`; refresca la sesión y reintenta
una vez si caduca ([PlayRiftboundReportSheet.swift, líneas 128–161](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/PlayRiftboundReportSheet.swift#L128-L161)).
Esta operación es una escritura autenticada. No hace falta para las
notificaciones de `riftbot`, pero confirma que los IDs correctos para un futuro
flujo de reporte son los del participante y del juego, no el ID del team ni el
nombre del jugador.

### Límites del modelo comunitario

Consort documenta que el sitio puede dejar `match.status` como `IN_PROGRESS`
después de que existan `teamOutcomes`; su modelo expone `isComplete` usando
ambas señales ([CompeteModels.swift, líneas 200–209](https://github.com/Okay-U/Riftbound-Consort/blob/e2724863332cbe1fa01eb76b7060c82c270574d5/Riftbound%20Companiokay/User/Events/CompeteModels.swift#L200-L209)).
El modelo soporta equipos y más de un jugador, pero la implementación de
`CompetePairing` no demuestra un torneo 2v2 real. `riftbot` debe conservar
`stageId + sectionId + roundNumber` como clave compuesta y no asumir que
`roundNumber` es global.

## 4. `riftbound_watcher`: alertas sobre el listado, no sobre emparejamientos

[`cafe-auvers/riftbound_watcher`](https://github.com/cafe-auvers/riftbound_watcher/tree/466b4277df6b0ddebebaef4d7c338f270463d7d8)
es el resultado relevante de buscar `riftbound watcher`. Es una utilidad personal
en Python que abre la búsqueda web de PlayRiftbound con Playwright, lee los
eventos renderizados y compara cada lectura con un `state.json` local. Avisa de
eventos nuevos y cambios de aforo como `FULL → OPEN`; no busca al jugador ni
resuelve rondas, mesas o rivales ([README, líneas 1–9 y 127–147](https://github.com/cafe-auvers/riftbound_watcher/blob/466b4277df6b0ddebebaef4d7c338f270463d7d8/README.md#L1-L9);
[código de extracción y comparación, líneas 516–555 y 744–831](https://github.com/cafe-auvers/riftbound_watcher/blob/466b4277df6b0ddebebaef4d7c338f270463d7d8/riftbound_watcher.py#L744-L831)).

La configuración predeterminada vuelve a leer la página cada 15 minutos, con
jitter, y la automatización carga el listado completo desplazando el panel de
resultados ([README, líneas 209–228](https://github.com/cafe-auvers/riftbound_watcher/blob/466b4277df6b0ddebebaef4d7c338f270463d7d8/README.md#L209-L228);
[bucle y frecuencia, líneas 1027–1102](https://github.com/cafe-auvers/riftbound_watcher/blob/466b4277df6b0ddebebaef4d7c338f270463d7d8/riftbound_watcher.py#L1027-L1102)).
El cliente extrae enlaces y texto del DOM del navegador y guarda el resultado de
cada escaneo; no tiene un cliente GraphQL propio ([extracción desde el DOM,
líneas 516–555](https://github.com/cafe-auvers/riftbound_watcher/blob/466b4277df6b0ddebebaef4d7c338f270463d7d8/riftbound_watcher.py#L516-L555)).
Si no logra extraer tarjetas, falla el escaneo y conserva el estado anterior
([líneas 959–993](https://github.com/cafe-auvers/riftbound_watcher/blob/466b4277df6b0ddebebaef4d7c338f270463d7d8/riftbound_watcher.py#L959-L993)).

Es una referencia para notificaciones de publicación/cupo y para tratar la
última lectura como snapshot persistido. No aporta el Watch de `riftbot`, que
necesita seguir el estado de un jugador dentro de una partida.

## 5. Extractor de manifiesto: cómo evitar que los hashes rompan el cliente

El script [extract-playriftbound-ops.py](https://github.com/Okay-U/okay-u.github.io/blob/b476887ff966e184b725c8e11b6ae0799fabff45/tools/extract-playriftbound-ops.py)
parte de `/en-US/events/`, extrae los chunks de Next.js, sigue referencias a
chunks cargados perezosamente, busca `apollo-persisted-query-manifest` y genera
un catálogo de operaciones ([líneas 14–70](https://github.com/Okay-U/okay-u.github.io/blob/b476887ff966e184b725c8e11b6ae0799fabff45/tools/extract-playriftbound-ops.py#L14-L70)).
El JSON generado el 16 de octubre contiene, entre otras, `CompeteTournamentSearch`,
`GetCompeteTournamentForRiftboundPlayer`, `PlayerTournaments`,
`GetCompeteRbRefreshPoller`, `SubmitGameResults`, registro/drop y
`OrganizerSummary` ([playriftbound-ops.json, líneas 1–70](https://github.com/Okay-U/okay-u.github.io/blob/b476887ff966e184b725c8e11b6ae0799fabff45/playriftbound-ops.json#L1-L70)).

El patrón recomendado para `riftbot` es:

1. Mantener el hash incorporado para que el servicio pueda arrancar sin red.
2. Descubrir o descargar el manifiesto con límites de tamaño, timeout y caché.
3. Validar que cada ID es exactamente hexadecimal de 64 caracteres.
4. Reintentar una vez tras `PERSISTED_QUERY_NOT_IN_LIST` o
   `PERSISTED_QUERY_NOT_FOUND`.
5. Si la actualización falla, conservar el hash anterior y marcar el proveedor
   como degradado; nunca devolver una lista vacía indistinguible de “no hay
   eventos”.

## 6. Falsos positivos y soluciones que no sirven

### `ben324/tt-watcher`

Su clase [PlayRiftboundEventSource.java](https://github.com/ben324/tt-watcher/blob/98bf499e356e749bc28d554352a93b676e2a7fa2/riftbound-events/riftbound-events/src/com/riftbound/events/playriftbound/PlayRiftboundEventSource.java)
es un **stub**: `list()` y `get()` lanzan
“not wired yet” y `parse()` devuelve una lista vacía. El proyecto tiene un watcher,
pero no aporta integración Play utilizable.

### `j-ding/RiftHub`

Aunque el README anuncia búsqueda, “My Events” y detalles, su módulo
[riftbound-api.js](https://github.com/j-ding/RiftHub/blob/04a5027474d0723d57b3f82c15615c72335dc0b9/riftbound-api.js#L1-L5)
llama a `api.cloudflare.riftbound.uvsgames.com/hydraproxy/api/v2`, el endpoint
antiguo de UVS. No es una implementación de PlayRiftbound.

### `shsshs010607-del/rift-reports`

Su script [seed-riftbound-schedule.ts](https://github.com/shsshs010607-del/rift-reports/blob/32bb2abe039dfeff09cd6b7a39fe08a392dd94a7/scripts/seed-riftbound-schedule.ts#L1-L14)
carga una instantánea de septiembre desde JSON y pide actualizarla manualmente.
El comentario del proyecto afirma que no hay API en vivo, pero PlayRiftbound sí
expone operaciones GraphQL usadas por los otros proyectos; la afirmación
describe este repositorio, que no implementa un cliente en vivo, no la
plataforma en general. El seed sirve como ejemplo de upsert idempotente, pero
una instantánea no conserva listados actuales ni Watch.

## 7. Qué tomar para `riftbot`

La evidencia comunitaria permite cerrar el diseño de la sustitución:

| Necesidad de `riftbot` | Implementación de referencia | Decisión para el adapter |
|---|---|---|
| `/events` por ubicación | Riftfound, Joutes | Riftfound persiste un catálogo agregado con cobertura rotatoria; Joutes consulta por ubicación de tienda y sincroniza sus filas al refrescar la fuente |
| Resolver organizador/tienda | Joutes | Desde un enlace de evento → `GetCompeteTournamentForRiftboundPlayer` → `organizerId` → `OrganizerSummary`; persistir el UUID como texto |
| Ficha y roster | Consort `CompeteModels` | `GetCompeteTournamentForRiftboundPlayer`; conservar stages, sections, rounds, registrants y participants |
| `/watch` de partidas | Consort `CompetePairing` y `PlayRiftboundMatchStore` | El código resuelve el emparejamiento con el Riot ID de la sesión y refresca por acciones de interfaz; no hay un proceso autónomo de polling a 45 s |
| Avisos de cambios en el catálogo | `riftbound_watcher` | Compara snapshots del listado y cupos aproximadamente cada 15 min; no genera avisos de ronda o resultado |
| `/mytable` | No hay equivalente comunitario sin sesión | `PlayerTournaments` devuelve los eventos de la cuenta conectada; Joutes importa eventos por tienda, no la mesa de un jugador |
| Reporte de resultados | Consort `SubmitGameResults` | Solo si se decide añadir escritura autenticada; no es necesario para Watch de solo lectura |
| Hashes rotatorios | Riftfound + extractor Python | Catálogo central, fallback incorporado, refresco controlado y error distinto de lista vacía |
| Cancelaciones | Ninguna implementación encontrada | No inferir `cancelled` desde lista vacía; usar política de ausencias válidas y dejar señal explícita como desconocida |
| Conflictos/subtipo de empate | Ninguna implementación encontrada | Conservar `TIE` como empate sin subtipo; no inventar conflicto/intencionalidad |
| 2v2/multifase | Modelo Consort, sin torneo público 2v2 probado | IDs por team y ronda compuesta; añadir fixtures propios antes de afirmar paridad |

La evidencia apunta a separar la fuente de listados de la lectura de partidas:
Riftfound/Joutes cubren la ingestión o sincronización de eventos públicos;
Consort muestra cómo derivar pairings con una sesión de jugador. El watcher de
Kakao solo compara snapshots del catálogo. Si Play falla, la fuente no debe
convertir el error en una lista vacía ni borrar un seguimiento.

## 8. Resultado de la investigación

En las búsquedas revisadas hay código ejecutable para la ingestión de listados,
la sincronización por tienda, las alertas sobre cambios de cupo y la vista de
pairing de un jugador autenticado. No encontramos un proyecto TypeScript/Telegram
que implemente la migración completa de `/events`, `/mytable`, `/watch`, rondas,
standings, cancelaciones y compatibilidad 2v2.

La paridad demostrable es:

- listados, paginación, precios, capacidad, enlace, tienda y normalización: sí;
- detalle, roster, rondas, mesas, W/L/D, byes y standings: sí, en el modelo y
  vistas de Consort; su refresh se dispara desde la UI, no mediante un bucle que
  consulte automáticamente cada 45 segundos. `GetCompeteRbRefreshPoller` está
  catalogado pero no se usa en el MatchStore revisado;
- reporte de resultados: técnicamente sí, pero requiere sesión autenticada y es
  una operación de escritura;
- cancelación explícita, conflicto de reportes y subtipo de empate: no expuestos
  por las implementaciones públicas revisadas;
- 2v2 y varias fases: el contrato tiene las piezas, pero falta un fixture real
  de aceptación.

La investigación no ejecutó código de terceros ni almacenó cookies, tokens o
secretos. Todas las referencias de código están fijadas a commits concretos.
