# Huecos de paridad del proveedor de eventos (2026-10-16)

Este informe cierra las comprobaciones que faltaban para reemplazar UVS/Riftbound
V2 por PlayRiftbound y conservar el comportamiento de `riftbot`. Se basa en el
frontend público y en respuestas GraphQL públicas capturadas el 16 de octubre
de 2026. No se usaron cuentas Riot, endpoints de administración ni acciones que
modifiquen torneos.

La conclusión es concreta:

- El proveedor nuevo tiene datos suficientes para `/events`, la ficha, el
  roster, el marcador, las rondas, las mesas y el watcher en torneos 1v1.
- El contrato público también contempla 2v2 y varias fases, pero el dominio
  actual debe cambiar antes de poder afirmar paridad. La evidencia de 2v2 es
  la consulta y el modelo del frontend; no se encontró un torneo 2v2 público
  en la búsqueda realizada.
- No se ha encontrado una señal pública demostrada para `CANCELLED`, conflicto entre
  reportes o empate intencional/no intencional. Esos estados deben quedar como
  desconocidos para Play, no inferirse de una ausencia o de un `TIE`.
- `/mytable` no tiene una sustitución pública equivalente basada solo en un
  nombre de usuario. Play permite obtener el estado de un jugador dentro de un
  torneo conocido; no se encontró una operación pública demostrada que busque el torneo actual de cualquier usuario sin sesión Riot.

## Fuentes primarias y versión observada

La aplicación pública se sirve desde [PlayRiftbound Events](https://playriftbound.com/en-US/events/)
y reescribe al frontend de eventos en `events.playriftbound.com`. El transporte
GraphQL es [`/api/gql`](https://events.playriftbound.com/api/gql). El frontend
capturado carga estas piezas de primera mano:

- [Manifiesto Apollo de consultas persistidas](https://events.playriftbound.com/_next/static/chunks/3nzz3d32kaukt.js).
- [Fragmentos y helpers de torneos Riftbound](https://events.playriftbound.com/_next/static/chunks/2kd-_vtq5am73.js).
- [Buscador de eventos y sus filtros](https://events.playriftbound.com/_next/static/chunks/3w6urtzoa_sbc.js).
- [Cliente Apollo y transporte](https://events.playriftbound.com/_next/static/chunks/39k90rc1nq_o7.js).

Las operaciones públicas relevantes y sus identificadores del manifiesto son:

| Operación | Hash persistido | Uso |
|---|---|---|
| `CompeteTournamentSearch` | `7791f530b0e27f81a3ef1c8571099cb6a96e0bfb9fadd4ff66bfd4929a323e86` | Listado por coordenadas, radio y cursor |
| `GetCompeteTournamentForRiftboundPlayer` | `e56d6d93e4f8fa287557521535544350e5cc9baafd78ba69f9f592873b090e57` | Ficha, roster, fases, rondas, mesas y standings |
| `GetCompeteRbRefreshPoller` | `459dbd58b231ad1767b999a1bf987836123ac86a0b5110e166de15b69723ba0d` | `updatedAt` para decidir si refrescar |
| `OrganizerSummary` | `9142e18241bb86a3b4c2692d899b31aaf61d11065ca8a259191aa9cc0a06ed57` | Dirección y datos del organizador |
| `PlayerTournaments` | `325210614006360e6f6bda3de390704e7f974f16f4d20361a1a3f29fb2101fd7` | Torneos del jugador autenticado |
| `GetCompeteTournaments` | `745fb68848143b4d7b8ca8991e4a8f596f3fe431b6072a7f3faf36cf658f357d` | Catálogo genérico distinto de `competeTournaments` |

Las lecturas públicas probadas necesitaron los headers de Apollo que expone el
cliente (`apollographql-client-name: Esports Web` y
`apollographql-client-version: b3891f6`). No necesitaron cookie, `Authorization`
ni API key. Los hashes y la versión del cliente pertenecen al despliegue
capturado; deben estar centralizados y ser fáciles de actualizar porque el
frontend puede cambiar sus bundles.

## Cancelación y estado del torneo

### Lo que expone Play

`GetCompeteTournamentForRiftboundPlayer` solicita para cada torneo:

```graphql
id name startsAt endsAt updatedAt visibility pricing
registrationPolicy registrantCounts stages config
tournamentParticipants tournamentRegistrants
```

El `config` incluye `roundCount`, `structure`, `playerFormat` y
`matchFormat`. Cada ronda contiene `status`; cada participante contiene
`status`. El detalle público no solicita ni devuelve un campo de estado de
torneo equivalente a `event_status: CANCELLED` de UVS. `visibility` describe si
se publica (`LISTED`/`UNLISTED`), no si se canceló.

El helper del frontend llamado `getTournamentStatus` confirma la semántica que
la propia web usa hoy:

1. Si no hay participantes o fases, devuelve `UNSTARTED`.
2. Si hay fases, compara todas las rondas de todas las secciones con
   `config.roundCount`.
3. Solo devuelve `COMPLETED` cuando todas las rondas están `FINALIZED`; en
   cualquier otro caso devuelve `IN_PROGRESS`.

No incluye una rama `CANCELLED`. La misma lógica aparece en el fragmento
 público de helpers enlazado arriba, junto con los enums `UNSTARTED`,
`IN_PROGRESS`, `COMPLETED`.

### Comprobaciones reproducibles

La operación de detalle respondió:

- Para `117093196872746571` (JUPITER JUEGOS SEVILLA), HTTP 200, un torneo
  `LISTED`, una fase, tres rondas y `updatedAt`.
- Para `117095965990633192` (La Cueva Roja), HTTP 200, un torneo `LISTED`, una
  fase, cinco rondas y participantes con estados `ACTIVE` y `DROPPED`.
- Para `999999999999999999`, HTTP 200 con `data.competeTournaments: []` y sin
  `errors`.
- Para `prb-117093196872746571`, HTTP 200 con `BAD_REQUEST` porque el argumento
  debe contener solo dígitos.

El manifiesto también contiene `GetCompeteTournaments`, cuyo cuerpo consulta
el campo genérico `tournaments(hl:, id:)` y solicita `state`. Probar ese hash
con el ID de Play `117093196872746571` devolvió `tournaments: []` para las
locales probadas. No es una ruta de estado para los objetos
`competeTournaments` del buscador; mezclar ambos catálogos produciría una
clasificación falsa.

### Reemplazo y límite

El adapter Play debe derivar solo estos estados de dominio:

| Estado del bot | Regla Play |
|---|---|
| `upcoming` | No hay participantes/fases o no hay ronda publicada |
| `inProgress` | Hay torneo y no se cumplen todas las rondas `FINALIZED` |
| `complete` | Hay exactamente el conjunto de rondas esperado y todas están `FINALIZED` |
| `unavailable` | La consulta válida devuelve una lista vacía, tras aplicar la política de ausencias |
| error de proveedor | HTTP/GraphQL `BAD_REQUEST`, hash ausente, headers, schema, 5xx o timeout |

No se debe convertir una lista vacía en `cancelled`. La ausencia puede
significar un ID equivocado, un torneo retirado, un cambio de visibilidad o un
torneo cancelado. El watcher debe mantener la política de varias ausencias
para `unavailable`, registrar el código GraphQL por separado y conservar el
watch ante errores de contrato o transitorios.

Si el producto exige anunciar explícitamente “cancelado”, hace falta una fuente
adicional que lo publique: un campo GraphQL documentado, un webhook, un
endpoint autorizado del organizador o una decisión manual. La consulta pública
actual no permite implementar esa parte con precisión.

## Resultados, empates y conflicto de reportes

### Forma del dato nuevo

La consulta pública devuelve por partido:

```graphql
esportsMatchId tableNumber status
games { esportsGameId number teamOutcomes { esportsTeamId outcome } }
teamOutcomes { esportsTeamId outcome }
teams { esportsTeamId players { id displayName } }
```

El enum público `CompeteOutcome` del bundle generado contiene `WIN`, `LOSS`,
`TIE` y `FORFEIT`. En las respuestas reales de Júpiter y La Cueva Roja se
observaron `WIN`, `LOSS` y `TIE`. No hay campos de `reports_are_in_conflict`,
`match_is_intentional_draw` o `match_is_unintentional_draw` en la operación ni
en el fragmento `CompeteRbMatch`.

También hay una diferencia operacional importante: en los dos torneos reales
consultados, las rondas estaban `FINALIZED` pero los partidos llevaban
`status: IN_PROGRESS`. Por ello `match.status` no puede ser la única prueba de
que el resultado está pendiente. El resultado de un partido finalizado debe
calcularse desde `teamOutcomes`, usando el estado de la ronda y la presencia de
los resultados de juego como contexto.

### Mapeo seguro

El modelo nuevo debe conservar la información que sí existe y representar como
desconocida la que no existe:

| Play | Modelo recomendado | Paridad con UVS |
|---|---|---|
| `WIN`/`LOSS` | Resultado de cada equipo; derivar `win`/`loss` desde el equipo observado | Sí, para 1v1 y por equipo en 2v2 |
| `TIE` | `draw`, con `drawType: null` | Sí para empate; no para el subtipo |
| `FORFEIT` | Conservar `resultKind: 'forfeit'`; derivar ganador/perdedor solo si el conjunto de outcomes es inequívoco | Información adicional; no confundir con conflicto |
| `teamOutcomes: null` o ronda no publicada | `pending`/`unavailable` según el contexto | Sí como estado desconocido |
| Reportes incompatibles | `conflict: unsupported` o `unknown` | No observado en las consultas públicas examinadas |

`EventPairing.drawType` puede seguir existiendo para filas UVS históricas,
pero el mapper Play debe producir `null`. No debe inferir “intencional” por un
`TIE`, ni inferir “conflicto” por una ausencia de resultado. Para no perder un
`FORFEIT`, conviene sustituir el booleano implícito por un subtipo de resultado
en la entidad del proveedor o ampliar el union de dominio.

El watcher solo debe avanzar `lastSeenResult` cuando el resultado del equipo
observado sea determinista. Un `TIE` sí genera `draw`; un conflicto no observable
no debe generar una notificación falsa de victoria, derrota o empate.

## Varias fases, secciones y rondas

### Contrato observado

El detalle público tiene esta jerarquía:

```text
tournament
└── stages[] { esportsStageId, name
    └── sections[] { esportsSectionId
        └── rounds[] { roundNumber, status, startedAt,
                       byeTeamIds, matches[], endOfRoundStandings[] }
    }
}
```

La ronda no trae un `roundId` independiente en el fragmento público. Por eso
`roundNumber` solo no identifica una ronda: una fase suiza y una fase de
eliminación pueden tener ambas una ronda 1.

El helper del frontend `getCurrentStage` selecciona la primera fase del array
y `getCurrentSection` busca la sección activa dentro de esa fase. A la vez,
`getTournamentStatus` aplana las rondas de todas las fases para decidir si el
torneo terminó. Esto sirve para la pantalla actual, pero no es suficiente para
un bot que debe navegar todas las rondas históricas.

### Sustitución requerida

El dominio debe introducir referencias estables, por ejemplo:

```typescript
type EventRef = { provider: 'play' | 'uvs'; id: string };
type RoundRef = {
  provider: 'play' | 'uvs';
  eventId: string;
  stageId: string;
  sectionId: string;
  roundNumber: number;
};
```

La implementación puede mostrar `Round 1` al usuario, pero las consultas,
callbacks, caché y snapshots deben usar `RoundRef`. El adapter debe conservar todas las fases. Para elegir una ronda, el helper de la web usa `PENDING`, `READY`, `IN_PROGRESS`, y después la última `FINALIZED`; trasladar esa prioridad a varias fases requiere pruebas adicionales y no debe deducirse simplemente de la posición en el array. Si hay
varias secciones activas, debe devolver una referencia inequívoca y dejar el
resto disponible para navegación.

La finalización derivada debe comprobar el total de rondas esperado y todas las
fases. El test de aceptación debe incluir dos fases con el mismo número de
ronda; una implementación que indexe por `roundNumber` debe fallar ese test.

## 2v2 y equipos

### Lo que está confirmado

El buscador actual declara `FRONTEND_PLAYER_FORMATS` con `ONE_V_ONE` y
`TWO_V_TWO`, y envía `playerFormats` en el filtro GraphQL. El detalle solicita
`config.playerFormat`, y el fragmento de partidos solicita `teams[].players[]`.
Los standings se identifican por `esportsTeamId`, no por `player.id`.

La búsqueda realizada el 16 de octubre con `playerFormats: ["TWO_V_TWO"]` no
devolvió eventos alrededor de Sevilla, Nueva York, Los Ángeles, Londres, San
Francisco, Sídney, París, Berlín, Ciudad de México o Singapur. Los resultados
sin ese filtro fueron 1v1. Esto confirma el contrato del frontend, pero no es
una muestra real de un payload 2v2. La compatibilidad completa debe quedar
pendiente de un fixture público 2v2 o de un torneo que aparezca en la búsqueda.

### Cambios de modelo

El modelo actual de `EventPairing` tiene `player1` y `player2` como nombres
individuales. No puede representar correctamente dos equipos. El reemplazo
debe:

1. Representar un partido como dos equipos, cada uno con `teamId` y una lista
   de `PlayerRef`.
2. Resolver un watch por `player.id` y después seleccionar el equipo del
   jugador; el rival es el otro equipo, no un solo nombre.
3. Calcular el resultado desde el `teamOutcome` del equipo observado.
4. Unir `endOfRoundStandings.esportsTeamId` con los equipos y mostrar todos los
   jugadores. No usar un `Map<teamId, player>` que sobrescriba al primer
   compañero.
5. Representar un bye mediante `byeTeamIds`, aunque no haya rival ni mesa.

No se debe aplanar 2v2 silenciosamente a dos nombres, ni marcarlo como
soportado hasta probar el mapper, el formatter y el watcher con un fixture de
dos jugadores por equipo.

## `/mytable` y la identidad de jugador

`/mytable` usa un adapter separado (`NexusTableAdapter`) y un endpoint
username-only configurado en [`src/config.ts`](../../src/config.ts). No se
convierte automáticamente al cambiar el proveedor de eventos.

Play sí devuelve `player.id` y `displayName` dentro de un torneo conocido. Su
operación `PlayerTournaments` no recibe un nombre de usuario: devuelve los
torneos del jugador autenticado y, sin sesión, respondió HTTP 200 con
`UNAUTHENTICATED`. `GetPlayer` consulta `pickemPlayer`, que pertenece a otra
función y tampoco resuelve el “torneo actual” de un nombre arbitrario.

La sustitución pública demostrada consiste en vincular al usuario del bot a una
identidad estable dentro de un evento (`eventId` + `player.id`) y leer el
detalle de ese evento. Eso permite conservar una vista de mesa para un watch o
evento seleccionado, pero no conserva la semántica actual de
consulta por nombre publicada para `/mytable <username>` (el ámbito del lookup Nexus depende del servicio y su tienda; no se ha demostrado que sea global). Además, el parser actual del bot rechaza ese argumento directo y solo llega al lookup con `/mytable show <username>`; es una discrepancia ya existente entre ayuda e implementación que debe corregirse al conservar el flujo. Para conservar
esa orden sin una cuenta Riot o una nueva fuente pública, el estado es
**no resoluble con la evidencia actual**. El análisis de migración contiene el
plan de coexistencia y la evidencia de Nexus para esta decisión:
[`events-migration-impact-2026-10.md`](./events-migration-impact-2026-10.md).

## Diseño de reemplazo que preserva lo que sí está disponible

La migración debe cruzar todo el recorrido con referencias de proveedor:

```text
Play search
  → EventRef(provider='play', id:string)
  → Play detail (one persisted query)
  → stages/sections/rounds + team/player refs
  → mapper de detalle/standings/pairings
  → callbacks compactos y SQLite TEXT
  → watcher agrupado por EventRef
```

El cliente GraphQL debe centralizar operación, hash, variables y headers; validar
`errors` incluso con HTTP 200; distinguir `[]` válido de `BAD_REQUEST`; y
registrar `updatedAt` sin depender de él como única señal de cambio. La
consulta de detalle debe compartirse entre ficha, navegación y watcher para no
descargar el torneo una vez por cada ronda.

El almacenamiento y los callbacks deben conservar IDs como texto. La identidad
del jugador debe ser `player.id`, no `displayName`, y la identidad de una ronda
debe incluir fase y sección. Las claves y los botones antiguos UVS deben
seguir pudiendo resolverse durante la transición; los tokens Play deben caber
en los 64 bytes de `callback_data` de Telegram ([límite oficial](https://core.telegram.org/bots/api#inlinekeyboardbutton)).

La migración debe mantener estas reglas del watcher:

- timeout, 5xx, 429 y errores GraphQL transitorios conservan el watch;
- hash inválido, schema incompatible o `UNAUTHENTICATED` son errores de
  proveedor y no tres “eventos desaparecidos”;
- una lista vacía para un ID válido activa la política de ausencias;
- `DROPPED`/`ELIMINATED` se leen de `tournamentParticipants`, no del estado de
  registro;
- antes de borrar un watch completado se procesa el último pairing y su
  resultado;
- los byes se notifican como resultado del equipo sin exigir rival o mesa;
- `TIE` notifica empate; subtipo y conflicto permanecen nulos/desconocidos.

## Criterios de aceptación y límites abiertos

La implementación no debe darse por terminada hasta probar, con fixtures
atravesando adapter y servicios:

1. listado Play → detalle → roster → standings → mesas → navegación de todas
   las fases;
2. IDs de 18 dígitos y UUID sin conversión a `number`, incluidos SQLite,
   reinicio y callbacks;
3. ronda finalizada con partidos cuyo `status` aún es `IN_PROGRESS`;
4. `TIE`, `FORFEIT`, bye, participante `DROPPED` y resultado corregido;
5. dos fases con rondas repetidas y un fixture 2v2 con dos jugadores por
   equipo;
6. lista vacía, `BAD_REQUEST`, hash obsoleto, 401, 429, 5xx y timeout sin
   borrar watches indebidamente;
7. una comprobación real de lectura pública del flujo Watch, sin crear un
   watch de producción ni enviar mensajes de prueba a usuarios.

Quedan explícitamente fuera de la paridad pública demostrada: la cancelación
explícita, el conflicto entre reportes, el subtipo intencional/no intencional
de empate, la detección automática del torneo en `/mytable` por nombre y la prueba de un
payload 2v2 real. Se necesita una fuente o fixture adicional para cerrar cada
uno de esos puntos. UVS puede conservarse solo para históricos durante una
transición controlada; el locator oficial ya remite los eventos de tienda
actuales a PlayRiftbound y no debe usarse como fallback operativo de eventos
nuevos.
