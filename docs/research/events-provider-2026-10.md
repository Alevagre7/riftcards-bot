# Nuevo proveedor de eventos de Riftbound (investigación 2026-10-16)

## Resultado

Desde Radiance Pre-Rift, el buscador nuevo es **PlayRiftbound.com**, una plataforma propiedad de Riot Games. El frontend público está servido por `events.playriftbound.com` y consume un backend GraphQL interno mediante `POST` o `GET` a:

```text
https://events.playriftbound.com/api/gql
```

El producto y la identidad del proveedor están confirmados por el anuncio oficial de Riot: PlayRiftbound.com pasó a ser la sede de Organized Play el 14 de septiembre de 2026, sustituyendo a Carde.io; el artículo lo describe expresamente como un sitio propiedad de Riot. El cambio empezó con la inscripción de Radiance Pre-Rift y también cubre la búsqueda, inscripción, pairings y resultados de los eventos.

Fuente primaria: [Introducing the New PlayRiftbound.com](https://playriftbound.com/en-us/news/announcements/introducing-the-new-playriftboundcom/) (Riot, 2026-09-04; ver especialmente las secciones sobre la migración y el motivo del cambio).

El locator antiguo de UVS (`locator.riftbound.uvsgames.com`) sigue accesible para datos históricos o eventos antiguos, pero no es el backend del buscador nuevo. El buscador actual es visible en [Play Riftbound — Events](https://playriftbound.com/en-US/events/).

## Evidencia del frontend y del transporte

Al solicitar `https://playriftbound.com/en-US/events/` el 2026-10-16, la respuesta fue `200` y contenía el header:

```text
x-middleware-rewrite: https://events.playriftbound.com/en-US/events/
```

La respuesta cargó una aplicación Next.js/Apollo. Los chunks públicos relevantes de esa misma respuesta son:

- [Apollo client chunk](https://events.playriftbound.com/_next/static/chunks/39k90rc1nq_o7.js): configura `uri: "/api/gql"`, `credentials: "include"`, PersistedQueryLink y los headers de Apollo Client Awareness.
- [Event finder chunk](https://events.playriftbound.com/_next/static/chunks/3w6urtzoa_sbc.js): contiene la consulta `CompeteTournamentSearch` y cómo el buscador construye sus variables.
- [Persisted query manifest](https://events.playriftbound.com/_next/static/chunks/3nzz3d32kaukt.js): manifiesto JSON de Apollo con los cuerpos e IDs de las operaciones. El módulo que lo carga está en `0r21mcvm608u2.js` (módulo `47828`).

El cliente usa `GET` para consultas persistidas cuando es posible, aunque el mismo payload funciona con `POST`. La API exige `Content-Type: application/json` para evitar su protección CSRF en `GET`.

El manifiesto actual contiene esta entrada para el buscador:

```text
operationName: CompeteTournamentSearch
persistedQuery.version: 1
persistedQuery.sha256Hash: 7791f530b0e27f81a3ef1c8571099cb6a96e0bfb9fadd4ff66bfd4929a323e86
```

El hash de `__meta__.hash` que aparece en el documento GraphQL del chunk de código no es el ID que acepta el servidor. Hay que usar el ID del manifiesto (`7791…`).

La petición pública necesita estos headers de Apollo Client Awareness:

```text
apollographql-client-name: Esports Web
apollographql-client-version: b3891f6
```

La versión es la que expone el bundle capturado en esta investigación. El servidor respondió `401 {"errors":[{"message":"No client headers set"}]}` sin ellos. No hizo falta cookie de sesión, `Authorization` ni API key para las consultas públicas probadas.

## Búsqueda pública

La operación es `CompeteTournamentSearch`. Su forma, extraída del manifiesto actual, es equivalente a:

```graphql
query CompeteTournamentSearch(
  $sport: Sport!
  $filter: CompeteTournamentSearchFilterInput!
  $sortBy: CompeteTournamentSearchSortInput
  $first: Int
  $after: String
) {
  competeTournamentSearch(
    sport: $sport
    filter: $filter
    sortBy: $sortBy
    first: $first
    after: $after
  ) {
    edges {
      cursor
      node {
        ... on RbTournamentSearchResult {
          distanceMeters
          organizer {
            id
            name
            isFavorited
            physicalAddress {
              city
              adminArea1
              formattedAddress
              latitude
              longitude
            }
          }
          tournament {
            id
            name
            startsAt
            pricing
            entryFee { currency minorUnits }
            registrantCounts { status count }
            config {
              ... on RiftboundTournamentConfig {
                tournamentType
                format
                playerFormat
                participantCapacity
                waitlistCapacity
              }
            }
          }
        }
      }
    }
    pageInfo { endCursor hasNextPage }
  }
}
```

El frontend llama a la operación así (resumen del código de `3w6urtzoa_sbc.js`):

```text
sport: "rb"
first: 20
filter.rb:
  coords: { latitude, longitude }
  startDate: new Date(Date.now() - 3600000).toISOString()
  distanceMeters: distance selected by the user
  types: event types, if selected
  formats: game formats, if selected
  playerFormats: player formats, if selected
  favoritedOrganizersOnly: true only for an authenticated user
sortBy: { rb: selected sort }, if selected
```

La búsqueda parte de coordenadas. El campo de texto `Where` del frontend selecciona una dirección mediante Google Places y después envía latitud/longitud; la cadena de dirección no se manda como filtro GraphQL. La lista inicial usa 20 resultados y continúa con `pageInfo.endCursor` como `$after`.

Los filtros y valores que aparecen en la UI actual son:

| Campo | Valores observados |
|---|---|
| `sport` | `rb` |
| `types` | `LEARN_TO_PLAY`, `NEXUS_NIGHT`, `OPEN_PLAY`, `PRE_RIFT`, `SUMMONER_SKIRMISH` |
| `formats` | `LIMITED_SEALED`, `LIMITED_DRAFT`, `CONSTRUCTED` |
| `playerFormats` | `ONE_V_ONE`, `TWO_V_TWO` |
| `sortBy.rb` | `DATE`, `DISTANCE`, `COST_LOW_TO_HIGH`, `COST_HIGH_TO_LOW` |
| `distanceMeters` | 8047, 16093, 24140, 32187, 40234, 80467, 160934 (5, 10, 15, 20, 25, 50, 100 mi en la UI) |

La aplicación usa 32187 metros como distancia por defecto. Para el bot, la conversión natural es `eventsRadiusKm * 1000`, no millas.

`pricing` puede ser `FREE` o `PAID`. En eventos pagados `entryFee.minorUnits` es la cantidad en la unidad menor de `entryFee.currency`; por ejemplo, la prueba devolvió `EUR` + `3500` para una entrada de 35 €. En eventos gratuitos, `entryFee` puede ser `null`. `registrantCounts` puede estar vacío y, cuando existe, contiene el estado y el recuento de inscritos.

No hay un límite superior de fecha en el filtro usado por el frontend. En una prueba separada, añadir `endDate` produjo una respuesta HTTP 200 con error GraphQL `BAD_REQUEST`, por lo que el cliente debe filtrar localmente si necesita una ventana `from/to`.

## Prueba reproducible de búsqueda

La siguiente consulta fue ejecutada el 2026-10-16 contra Sevilla, sin cookies ni sesión:

```bash
curl -sS \
  -H 'content-type: application/json' \
  -H 'apollographql-client-name: Esports Web' \
  -H 'apollographql-client-version: b3891f6' \
  --data-raw '{
    "operationName":"CompeteTournamentSearch",
    "variables":{
      "sport":"rb",
      "first":20,
      "filter":{"rb":{
        "coords":{"latitude":37.3891,"longitude":-5.9845},
        "startDate":"2026-10-16T00:00:00.000Z",
        "distanceMeters":100000
      }}
    },
    "extensions":{"persistedQuery":{
      "version":1,
      "sha256Hash":"7791f530b0e27f81a3ef1c8571099cb6a96e0bfb9fadd4ff66bfd4929a323e86"
    }}
  }' \
  https://events.playriftbound.com/api/gql
```

Resultado observado: HTTP `200`, `data.competeTournamentSearch.edges` con eventos reales de Radiance Pre-Rift alrededor de Sevilla, `distanceMeters`, datos de tienda, `startsAt`, capacidad, precio y `pageInfo.hasNextPage: true`. Entre los resultados estaban JUPITER JUEGOS SEVILLA (1.922 m) y La Cueva Roja (13.036 m). El endpoint devolvió IDs como cadenas, por ejemplo `"117093196872746571"`.

Una consulta con el hash `4cf7075b...` de `__meta__` devolvió HTTP `404` y `PERSISTED_QUERY_NOT_IN_LIST`. Una consulta con el ID correcto pero sin los headers Apollo devolvió HTTP `401` (`No client headers set`). Estas dos respuestas confirman que el ID del manifiesto y los headers forman parte del contrato práctico del endpoint.

## Detalle de evento

La ruta pública es `https://playriftbound.com/en-US/events/{tournamentId}`. En la prueba, la página de [JUPITER JUEGOS SEVILLA](https://playriftbound.com/en-US/events/117093196872746571) respondió HTTP 200 y se renderizó con datos del evento.

El frontend usa la operación persistida `GetCompeteTournamentForRiftboundPlayer`:

```text
operationName: GetCompeteTournamentForRiftboundPlayer
persistedQuery.sha256Hash: e56d6d93e4f8fa287557521535544350e5cc9baafd78ba69f9f592873b090e57
variables: { "tournamentId": "117093196872746571" }
```

El cuerpo de la consulta llama a:

```graphql
competeTournaments(esportsTournamentIds: [$tournamentId])
```

y devuelve una lista (aunque se solicite un solo ID) con `id`, `name`, `description`, `startsAt`, `endsAt`, `pricing`, `entryFee`, `registrationStartAt`, `registrationEndAt`, `registrationPolicy`, `visibility`, `registrantCounts`, el programa, y la configuración `RiftboundTournamentConfig` (`tournamentType`, `format`, `playerFormat`, `structure`, `matchFormat`, capacidades, política de waitlist, rondas y política de decklist). También incluye `stages`, `rounds`, `matches`, `tournamentParticipants` y `tournamentRegistrants`; en un evento ya iniciado estos campos contienen standings y resultados en vivo o finales.

La búsqueda entrega `organizer.id`, pero el detalle de la tienda se obtiene con otra operación pública del mismo GraphQL:

```text
operationName: OrganizerSummary
persistedQuery.sha256Hash: 9142e18241bb86a3b4c2692d899b31aaf61d11065ca8a259191aa9cc0a06ed57
variables: { "id": "<organizer.id>" }
```

La operación devuelve `name`, `type`, `physicalAddress` (dirección formateada, Google Place ID, latitud y longitud), `website`, y campos de contacto. Para un bot que solo necesita la ficha de evento, la dirección de `physicalAddress` es suficiente; conviene tratar los campos de contacto como datos opcionales y evitar mostrarlos si no son necesarios.

## Implicaciones para el adapter

1. El nuevo adapter debe apuntar a `https://events.playriftbound.com/api/gql`, enviar consultas persistidas y conservar los IDs como `string`. Los IDs numéricos observados tienen 18 dígitos y no deben convertirse a `number` en JavaScript (podrían superar `Number.MAX_SAFE_INTEGER`).
2. La búsqueda nueva usa metros, latitud y longitud. El adapter no debe reutilizar el parámetro antiguo `num_miles` de UVS.
3. La respuesta HTTP `200` no garantiza una respuesta válida: hay que comprobar `errors` además de `data`. La prueba con `endDate` demuestra que GraphQL puede devolver un error de negocio con HTTP 200.
4. La página pública no documenta un schema/API estable. El hash de cada operación y los nombres de los chunks pueden cambiar en cada despliegue. El manifiesto público es la fuente de verdad actual, por lo que conviene centralizar los IDs en constantes/configuración y revisar el manifiesto cuando el sitio cambie.
5. El buscador y el detalle público no necesitan cuenta Riot. Las operaciones de `My Events`, favoritos, inscripción y acciones de torneo sí están asociadas a autenticación Riot y no deben confundirse con las consultas públicas.

## Situación actual de riftbot

La implementación actual de [src/index.ts](../../src/index.ts) conecta `RiftfoundEventsAdapter` como proveedor principal de listados, con `RiftboundV2Adapter` como fallback. Los detalles y el seguimiento de torneos siguen usando exclusivamente UVS V2. El fallback se activa ante errores del proveedor principal, no ante una lista vacía ni para combinar ambos catálogos; por tanto no garantiza encontrar eventos de la nueva plataforma.

[EventListing](../../src/core/entities/event-listing.ts), [Event](../../src/core/entities/event.ts) e [IEventRepository](../../src/core/ports/event-repository.ts) usan IDs `number`. La migración requerirá revisar entidades, puertos, callbacks, enlaces, navegación y persistencia de seguimientos. Si se conservan eventos UVS durante la transición, la identidad debería incluir el proveedor y el ID original; un ID nuevo no puede enviarse al endpoint antiguo de detalle.

Esta investigación solo añade documentación; no implementa la migración.

## Matriz de preservación de funciones

Fuentes de los datos y helpers de esta sección: [fragmentos y lógica de torneos del frontend](https://events.playriftbound.com/_next/static/chunks/2kd-_vtq5am73.js) y [manifiesto de operaciones](https://events.playriftbound.com/_next/static/chunks/3nzz3d32kaukt.js). Las comprobaciones HTTP de esta ampliación devolvieron 200 sin sesión para cuatro eventos cercanos a Sevilla, incluyendo `117095965990633192` (La Cueva Roja: un bye y participantes retirados). No se enviaron mensajes de Telegram ni se crearon watches reales.

La siguiente matriz compara las funciones que hoy expone `riftbot` con los datos que realmente entrega el proveedor nuevo. “Compatible” significa que la fuente tiene los datos y que el adaptador puede conservar la función después de los cambios de modelo indicados. No significa que el código actual ya sea compatible.

| Función actual | Evidencia en PlayRiftbound | Estado | Cambios o límite que deben quedar cubiertos |
|---|---|---|---|
| `/events`: listado, radio, ventana temporal, tipo/formato y paginación | `CompeteTournamentSearch` devuelve coordenadas, `distanceMeters`, `startsAt`, configuración y cursor; acepta filtros `types`, `formats` y `playerFormats`. | Compatible | Adaptar metros, cursor y los campos `config`; mantener el filtrado local por fecha final porque el filtro observado solo tiene `startDate`. |
| Ficha básica del evento | El detalle devuelve nombre, descripción, inicio/fin, precio, capacidad, recuentos, configuración y `organizerId`; `OrganizerSummary` devuelve la dirección. | Compatible con huecos | No aparece una zona horaria IANA en el detalle público; las fechas son UTC. Hay que decidir cómo mostrar la hora. La URL sintetizada actual de UVS dejará de ser válida y debe apuntar a `playriftbound.com`. |
| Jugadores/roster para iniciar un watch | `tournamentRegistrants` devuelve `id` UUID, `status`, `player.id`, `displayName`, `tagLine`, `team` y waitlist. | Compatible con cambio de identidad | El modelo actual solo guarda `name` y usa IDs numéricos. El watch debe guardar el `player.id` estable y conservar `displayName#tagLine` solo para mostrarlo. El estado de registro no es el estado de participación en rondas. |
| Leaderboard | Cada ronda incluye `endOfRoundStandings` con rank, puntos, W/L/D y porcentajes. El nombre se obtiene uniendo `esportsTeamId` con sus jugadores. | Compatible en 1v1 | `EventStanding.name` debe aceptar la identidad resultante de esa unión. En 2v2 una fila es un equipo y puede contener dos jugadores, por lo que el modelo actual de un solo `name` no basta. |
| All tables / pairing actual | Cada match incluye mesa, equipos, jugadores, juegos y `teamOutcomes` (`WIN`, `LOSS`, `TIE`, `FORFEIT`). | Compatible en 1v1 con mapper nuevo | No usar `match.status` para decidir si hay resultado: en la respuesta real hay matches `IN_PROGRESS` dentro de rondas `FINALIZED`, pero los `teamOutcomes` ya son definitivos. El resultado y el marcador deben calcularse desde los juegos/equipos. |
| Navegación por rondas históricas | El detalle público trae todas las `stages.sections.rounds`, sus matches y sus standings; la UI expone `roundNumber` y `status`. | Datos confirmados; contrato actual incompatible | El fragmento público no expone un ID de ronda equivalente al `roundId: number` actual. Hay que navegar por una clave propia (por ejemplo, proveedor + evento + stage + section + número de ronda) o cambiar los puertos para extraer la ronda del bundle de detalle. |
| Watch: polling, refresh manual, diff, revision y salud | El mismo bundle contiene las rondas y pairings; `GetCompeteRbRefreshPoller` expone `updatedAt` y puede usarse para evitar descargas completas sin cambios. | Compatible en 1v1 | La agrupación por evento, el `fresh: true`, los reintentos y la persistencia se pueden conservar. Debe cambiar la identidad almacenada y el tipo de ID del evento. El poller de `updatedAt` es una optimización, no sustituye el detalle. Su hash probado es `459dbd58b231ad1767b999a1bf987836123ac86a0b5110e166de15b69723ba0d`, con variables `{ "tournamentId": "117093196872746571" }`; respondió HTTP 200 con `data.t.u` (timestamp `updatedAt`). |
| Watch: evento completado | El frontend calcula `COMPLETED` cuando hay participantes/stages, el número de rondas coincide con `config.roundCount` y todas están `FINALIZED`. La consulta real de Júpiter mostró 3 rondas finalizadas y la de La Cueva Roja 5. | Compatible con derivación | El nuevo detalle no tiene `displayStatus`/`eventStatus` top-level como UVS. Hay que centralizar esta derivación y tratar `FINALIZED` como el equivalente de `COMPLETE`; el estado de un match no sirve para ello. |
| Watch: jugador drop/eliminado | La respuesta real de La Cueva Roja contiene participantes `ACTIVE` y `DROPPED`; el bundle también declara `ELIMINATED`. | Compatible con cambio de fuente | El watcher actual mira `registrations[].status !== 'Active'`. En PlayRiftbound debe consultar `tournamentParticipants[].status`, uniendo por `player.id`; `REGISTERED` en `tournamentRegistrants` no significa que el jugador siga activo. Debe definirse si `ELIMINATED` termina el watch o solo informa del estado. |
| Watch: cancelación | La consulta pública usada no devuelve un estado de torneo cancelado. El helper del frontend solo distingue `UNSTARTED`, `IN_PROGRESS` y `COMPLETED` por participantes/rondas. | No garantizado | No se puede trasladar `eventStatus === 'CANCELLED'` con la evidencia actual. Un detalle ausente o un evento retirado del buscador solo permite decir “unavailable”; no debe notificarse como cancelado hasta encontrar un campo/consulta pública que lo confirme. |
| Byes | La respuesta real de La Cueva Roja contiene un `byeTeamIds` con un equipo; la UI tiene `isByeMatch` para resolverlo. | Datos confirmados; no preservado por el modelo actual | El bye no es necesariamente un match: no trae rival ni número de mesa. Hay que asociar `byeTeamIds` con los equipos y sintetizar una observación `bye` para el roster y el watcher, o extender `EventPairing` para permitir el caso sin mesa. Si no se hace, el watcher verá “sin pairing” y no avisará del bye. |
| Identidad 2v2 | El buscador expone `TWO_V_TWO` y los matches contienen `teams[].players[]`; la respuesta probada fue 1v1. | Capacidad confirmada; compatibilidad no garantizada | `EventPairing.player1/player2`, `getOpponent` y el diff del watcher asumen dos nombres individuales. Hay que modelar dos equipos con listas de jugadores, resolver el rival por equipo y decidir si un watch de un jugador informa el resultado de todo su equipo. |
| IDs, callbacks y persistencia | Los IDs de evento del nuevo provider llegan como strings de 18 dígitos; roster y jugadores usan UUID. | Bloqueo obligatorio antes de migrar | `number`, `parseInt`, `event_id INTEGER` y las claves actuales pueden perder precisión. Además, `event:117093196872746571:watch:select:<UUID>` ocupa 74 bytes y `watch:replace:<eventId>:<UUID>:<revision>` alrededor de 102 bytes, por encima del límite oficial de 1–64 bytes de [`callback_data`](https://core.telegram.org/bots/api#inlinekeyboardbutton). Hay que usar IDs string/proveedor y tokens cortos para callbacks antes de activar el proveedor. |
| `/watching`, stop, reemplazar y `/admin` | La gestión de suscripciones, revisiones y permisos es local al bot. | Conservable | Revisar callbacks y migración de persistencia; mantener seguimiento UVS por su proveedor original. No hay equivalencia demostrada entre IDs de eventos/jugadores antiguos y nuevos que permita convertir automáticamente suscripciones existentes. |
| `/mytable`, cartas, inline queries y preferencias | `/mytable` usa `NexusTableAdapter`; cartas y preferencias tienen dependencias independientes. | Sin cambio por esta investigación | `/mytable` sigue dependiendo de Nexus; no se ha verificado que Nexus encuentre torneos de PlayRiftbound. Cambiar el proveedor de `/events` no le añade esa capacidad. |

La evidencia práctica cubre el recorrido normal de detalle, roster, standings, pairings, rondas finalizadas, jugadores retirados y byes. No cubre una cancelación pública ni un evento 2v2 completo. Por tanto, se puede preservar el flujo de listados, detalle, leaderboard, rondas históricas y watch para eventos 1v1 después de adaptar los contratos, pero no se puede afirmar que “el resto” funcione automáticamente con solo cambiar la URL.

Los criterios mínimos para cerrar la migración del watch son: identificar al jugador por UUID, detectar `DROPPED`/`ELIMINATED` desde participantes, derivar `COMPLETED` con las rondas finalizadas, generar una observación para `byeTeamIds`, resolver `WIN`/`LOSS`/`TIE` desde `teamOutcomes`, conservar las rondas históricas y usar tokens de callback dentro de 64 bytes. La cancelación debe permanecer como estado pendiente hasta confirmar una señal pública del proveedor.

## Separación entre evidencia e inferencia

**Confirmado por fuente oficial o por una petición real:** migración de Carde.io a PlayRiftbound.com y propiedad de Riot; reescritura de `playriftbound.com` a `events.playriftbound.com`; endpoint `/api/gql`; uso de Apollo/persisted queries; hashes y nombres de las tres operaciones anteriores; headers Apollo requeridos en la prueba; respuesta pública sin sesión; campos y unidades de la respuesta; paginación por cursor; IDs serializados como strings; filtros y valores expuestos por la UI.

**Inferencia operativa:** el backend GraphQL parece ser el servicio interno llamado “Compete” (por los campos y operaciones `compete*`), pero no se encontró documentación pública que confirme el nombre del servicio como marca independiente. El hash y la versión del bundle son observaciones del despliegue del 2026-10-16 y pueden cambiar sin aviso.
