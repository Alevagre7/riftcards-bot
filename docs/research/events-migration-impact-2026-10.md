# Impacto de la migración de eventos a PlayRiftbound (2026-10)

Este documento audita la implementación local de `/events`, detalle, rondas,
leaderboard, `/watching`, el watcher de fondo y su persistencia frente al
proveedor GraphQL público de PlayRiftbound. El documento anterior
[`events-provider-2026-10.md`](./events-provider-2026-10.md) contiene las
peticiones reproducibles, hashes de persisted queries y la evidencia del
frontend. Aquí se describen los cambios que todavía hacen falta y los puntos
que romperían si solo se cambiara la URL del proveedor.

Las etiquetas tienen este significado:

- **Observado:** aparece en el código o se comprobó en una respuesta real.
- **Inferido:** consecuencia directa del contrato observado y del código
  actual; debe cubrirse con una prueba antes del despliegue.
- **No resuelto:** la consulta pública o el código disponible todavía no da
  una respuesta suficiente.

## Resultado de la auditoría

La migración no es un cambio aislado de `IEventListingRepository`. El índice
actual conecta Riftfound solo para listados y mantiene Riftbound V2 como fuente
exclusiva de detalle y datos vivos ([`src/index.ts:63-77`](../../src/index.ts#L63)).
Por tanto, un listado PlayRiftbound entrega un ID que se enviaría a los
endpoints UVS `/events/{id}` y `/tournament-rounds/{id}`; el detalle sería
`null` o fallaría y el watch no podría consultar el torneo.

Los bloqueos que deben resolverse antes de activar eventos nuevos son:

| Prioridad | Bloqueo | Efecto visible |
|---|---|---|
| P0 | El adaptador de listados activo ya rechaza respuestas reales de Riftfound: `externalId` tiene forma `prb-117093196872746571` y `endDate` puede ser `null` ([`riftfound-events.adapter.ts:10-18`](../../src/infrastructure/apis/riftfound-events.adapter.ts#L10)). | Se cae al fallback UVS; en la prueba real de Sevilla ese fallback devolvió cero eventos aunque Riftfound tenía 32. `/events` queda vacío. |
| P0 | La paginación real de Riftfound devolvió los mismos 32 IDs en `page=1` y `page=2` aunque `totalPages=2`; el adapter concatena todas las páginas sin deduplicar ([`riftfound-events.adapter.ts:55-88`](../../src/infrastructure/apis/riftfound-events.adapter.ts#L55)). | Al corregir el schema, el listado mostraría duplicados; la corrección necesita deduplicación por proveedor + ID y una prueba contra esa respuesta. |
| P0 | IDs de torneo, registro y jugador se tratan como `number` ([`event.ts:9-16`](../../src/core/entities/event.ts#L9), [`event-registration.ts:9-17`](../../src/core/entities/event-registration.ts#L9), [`event-watch.ts:7-18`](../../src/core/entities/event-watch.ts#L7)). | El ID Play de 18 dígitos pierde precisión al pasar por JavaScript/SQLite. Un detalle, watch o callback puede apuntar a otro torneo. |
| P0 | El contrato de detalle y live sigue siendo UVS (`IEventRepository`, `RiftboundV2Adapter`) ([`index.ts:65-77`](../../src/index.ts#L65)). | Abrir un evento Play, ver rondas/leaderboard o iniciar un watch falla aunque el listado funcione. |
| P0 | Varios callbacks superan el límite oficial de 64 bytes: selección Play con ID de evento + UUID de jugador mide 74 bytes; reemplazo es aún mayor ([`event-callback.ts:66-74`](../../src/bot/actions/event-callback.ts#L66)). | Telegram rechaza el teclado o el callback no llega al bot. |
| P0 | `user_event_watches.event_id` es `INTEGER` y el repositorio usa tipos `number` ([`004_event_watches.sql:8-22`](../../src/infrastructure/persistence/migrations/004_event_watches.sql#L8), [`sqlite-event-watch-repository.ts:13-74`](../../src/infrastructure/persistence/sqlite-event-watch-repository.ts#L13)). | El valor grande se convierte a un `number` impreciso al leerlo; los watches existentes no tienen proveedor ni identidad estable del jugador. |
| P1 | El buscador Play probado no incluye `endsAt`; el render actual elimina cualquier evento cuyo `endDatetime` no sea una fecha válida ([`events.ts:97-110`](../../src/bot/commands/events.ts#L97)). | Si el mapper usa `undefined`, `NaN >= now` elimina todos; si inventa el inicio como fin, puede ocultar eventos en curso o mostrar eventos terminados. |
| P1 | La UI nueva usa estados y nombres distintos (`PRE_RIFT`, `NEXUS_NIGHT`, `SUMMONER_SKIRMISH`) ([`event-listing.ts:3-8`](../../src/core/entities/event-listing.ts#L3)). | Pre-Rift y Nexus Night se muestran como `Other` y pierden su icono/etiqueta. |
| P1 | El precio nuevo es `entryFee.minorUnits`; el formatter siempre divide por 100 ([`event-detail-formatter.ts:55-64`](../../src/bot/formatters/event-detail-formatter.ts#L55)). | Monedas con una escala distinta se muestran mal; `FREE`/`entryFee: null` requieren un mapeo explícito. |
| P1 | Rondas y partidos actuales se identifican por un único `number` ([`event-repository.ts:30-39`](../../src/core/ports/event-repository.ts#L30)); Play organiza `stages.sections.rounds`. | La navegación histórica no puede resolver dos rondas con el mismo número ni usar los IDs esperados por el endpoint UVS. |
| P1 | El watcher termina el watch antes de procesar la última pairing cuando detecta evento finalizado o jugador fuera ([`event-watcher.ts:215-243`](../../src/bot/services/event-watcher.ts#L215)). | El resultado de la ronda final puede no notificarse; `DROPPED`/`ELIMINATED` debe derivarse de participantes, no de registros. |
| P2 | El enlace de detalle siempre apunta al locator UVS ([`event-detail-formatter.ts:157-159`](../../src/bot/formatters/event-detail-formatter.ts#L157)). | El usuario abre una página que no conoce el ID Play. |

## Decisión de fuente tras el cierre de UVS

El [locator oficial de UVS](https://locator.riftbound.uvsgames.com/) informa que desde el **15 de octubre de 2026** ya no permite buscar, organizar o registrar eventos de tienda y remite a PlayRiftbound. Esto actualiza la estrategia propuesta: **PlayRiftbound debe ser la única fuente operativa para torneos nuevos; UVS no debe ser fallback de búsquedas actuales**. Una caída de Riot debe mostrarse como fallo recuperable, no como una lista vacía procedente de un catálogo retirado.

Las peticiones de lectura de esta investigación aún obtuvieron HTTP 200 para el evento UVS `799609`, sus 11 registros y los matches/standings de la ronda `1172657`. Eso demuestra disponibilidad histórica de esos recursos, no cobertura de eventos actuales. UVS se puede conservar separado para referencias antiguas y watches ya guardados; no como sustituto de Riot ante errores.

En una comprobación de solo lectura del contenedor desplegado se encontró **un watch persistido** y la columna `event_id INTEGER`. Por tanto, preservar las filas antiguas es un requisito real de despliegue, no solo una hipótesis de diseño. No se mostraron ni modificaron datos personales o filas de usuario.

Si se conserva Riftfound como agregador opcional, seguirá necesitando las correcciones de schema, fechas y deduplicación descritas abajo. Esas correcciones no son necesarias para un diseño que lo retire del camino operativo y consulte Riot directamente. Ninguna opción debe volver a enviar un ID `prb-…` al detalle UVS.

## 1. Fuente y composición de adapters

### Estado observado

La inyección actual crea `RiftfoundEventsAdapter` como proveedor primario de
listados y `RiftboundV2Adapter` como fallback y repositorio de detalle
([`src/index.ts:63-77`](../../src/index.ts#L63)). El fallback solo se usa si el
primario lanza una excepción y no combina resultados ni prueba el fallback ante
una lista vacía ([`fallback-event-listing-repository.ts:12-23`](../../src/infrastructure/apis/fallback-event-listing-repository.ts#L12)).

En una petición real a Riftfound para Sevilla, la respuesta incluyó IDs con el
prefijo `prb-` y `endDate: null`. El schema exige solo dígitos y una cadena
no-nula ([`riftfound-events.adapter.ts:10-18`](../../src/infrastructure/apis/riftfound-events.adapter.ts#L10));
el parseo falla en [`riftfound-events.adapter.ts:115-120`](../../src/infrastructure/apis/riftfound-events.adapter.ts#L115).
El fallback UVS no devuelve los 32 eventos que sí devolvió Riftfound para la
misma consulta. Esto es un fallo actual, anterior a cualquier migración de este repositorio, y los
fixtures numéricos no lo cubren.

La misma comprobación devolvió `data.length = 32` en las dos páginas, con los
mismos IDs, aunque `pagination.totalPages = 2`. El bucle actual concatena
ambas páginas sin deduplicar ([`riftfound-events.adapter.ts:59-88`](../../src/infrastructure/apis/riftfound-events.adapter.ts#L59)).
Esto es **observado** en el upstream actual; no se debe asumir que el campo
`page` sea una partición fiable sin deduplicación.

El API nuevo acepta `POST` o `GET` a `/api/gql`, `operationName`, variables, hash de
persistent query y headers Apollo. Una respuesta HTTP 200 puede contener
`errors`, y un detalle ausente se devuelve como una lista vacía. La evidencia,
los hashes y los ejemplos están en
[`events-provider-2026-10.md`](./events-provider-2026-10.md#evidencia-del-frontend-y-del-transporte).

### Cambio requerido

Hay que introducir un adapter Play que implemente ambos lados de la frontera
que hoy cubre V2:

1. `IEventListingRepository.getEvents` para la búsqueda por coordenadas,
   distancia en metros y cursor.
2. `IEventRepository.getEventById`, `getEventRegistrations`,
   `getEventDetail`, `getEventMatches` y `getEventStandings` para el detalle
   público, rondas, standings y pairings.

Si se conservan eventos UVS durante la transición, el puerto debe transportar
una referencia de evento con proveedor e ID, por ejemplo `{ provider: 'uvs' |
'play', id: string }`. El adapter debe despachar por esa referencia. Un ID Play
no se puede reenviar a `RiftboundV2Adapter`; un ID UVS tampoco debe formar una
URL Play por coincidencia numérica.

La alternativa de retirar UVS por completo exige una política explícita para
los watches y enlaces existentes. No hay una equivalencia pública demostrada
entre un evento UVS antiguo, un torneo Play y un jugador de ambos sistemas.

### Aceptación

- Una respuesta real de Riftfound con `prb-...` y `endDate: null` no rompe el
  adapter que se mantenga como fallback; un test fixture cubre ambos campos.
- Si se mantiene Riftfound, respuestas repetidas entre páginas producen una
  sola entrada por `provider + externalId`.
- Un resultado Play se puede listar, abrir y consultar en detalle con el mismo
  objeto de referencia, sin pasar por `Number`.
- Una lista vacía del proveedor primario tiene la política definida: fallback,
  unión o respuesta vacía. Esa política se prueba y se registra; no se deduce
  del `catch` actual.
- Una respuesta HTTP 200 con `errors` se clasifica como error GraphQL. No se
  convierte en `null` ni se reintenta como si fuera un torneo inexistente.

## 2. Búsqueda, fechas, unidades y paginación

### Estado observado

El puerto recibe `startAfter`, `startBefore` y `EventLocation.numMiles`
([`event-listing-repository.ts:4-10`](../../src/core/ports/event-listing-repository.ts#L4),
[`event-repository.ts:9-16`](../../src/core/ports/event-repository.ts#L9)). El
comando amplía el comienzo 12 horas para incluir torneos en curso y después
filtra por `endDatetime` ([`events.ts:97-110`](../../src/bot/commands/events.ts#L97)).
El `EventLocation` global se construye desde kilómetros y se convierte una vez
a millas ([`index.ts:78-82`](../../src/index.ts#L78)). Las preferencias se
guardan en km y se convierten en `resolveEventLocation`
([`events.ts:63-80`](../../src/bot/commands/events.ts#L63)).

Play usa `distanceMeters`, `startDate` y cursor `after`. La consulta pública
probada no acepta `endDate`; añadirlo devolvió un error GraphQL `BAD_REQUEST`.
El detalle sí contiene `endsAt`, pero el buscador no lo solicita ni lo entrega
en la forma observada.

### Cambio requerido

Mantener el lookback de 12 horas del bot y convertir el radio de km a metros en
el adapter. Conviene renombrar `numMiles` a `radiusKm` o `radiusMeters` en el
puerto para que no quede una unidad histórica en toda la aplicación; si se
mantiene compatibilidad temporal, el adapter Play debe ser el único lugar que
interprete la conversión.

El adapter debe:

- enviar `startDate = startAfter.toISOString()`;
- no enviar `endDate` al GraphQL nuevo;
- recorrer `pageInfo.endCursor` hasta `hasNextPage` con una cota y detección de
  cursor repetido;
- filtrar localmente por `startDatetime <= startBefore`;
- conservar un `endDatetime` opcional o aplicar una regla explícita que no
  descarte un evento sin fin conocido.

El contrato actual no permite representar “fin desconocido”: `EventListing`
requiere `endDatetime: string` ([`event-listing.ts:11-16`](../../src/core/entities/event-listing.ts#L11)).
No se debe poner la hora de inicio como hora de fin sin una decisión de
producto. La opción segura para no perder eventos en curso es hacer el fin
opcional y filtrar solo cuando existe; el detalle puede completar `endsAt` al
abrirse.

El `first: 20` del frontend no debe confundirse con el máximo de resultados
del bot. Si se filtran fechas localmente, hay que seguir cursores suficientes
para cubrir la ventana o parar cuando el orden de fecha permita demostrar que
los resultados restantes quedan fuera.

### Aceptación

- Un evento que empezó hace 2 horas y no tiene `endsAt` permanece en la lista.
- Un evento terminado con `endsAt` anterior a `now` se elimina.
- Un evento futuro después de `startBefore` se elimina aunque haya venido en
  la misma página GraphQL.
- El radio de 80 km genera `distanceMeters: 80000`; no se redondea a millas.
- Se conserva el lookback de 12 horas y la paginación no duplica resultados ni
  entra en bucle cuando el cursor se repite.

## 3. Modelo de identidad, URLs y callbacks

### Estado observado

La entidad de listado, evento, fases, rondas y registros usa números
([`event-listing.ts:11-21`](../../src/core/entities/event-listing.ts#L11),
[`event.ts:9-56`](../../src/core/entities/event.ts#L9),
[`event-registration.ts:9-19`](../../src/core/entities/event-registration.ts#L9)).
Los handlers convierten cada callback a `number`, por ejemplo listado y detalle
([`event-callback.ts:105-119`](../../src/bot/actions/event-callback.ts#L105)) y
watch de registro ([`event-callback.ts:172-180`](../../src/bot/actions/event-callback.ts#L172)).
El comando directo también hace `Number(...)`
([`events.ts:332-343`](../../src/bot/commands/events.ts#L332)).

Play devuelve IDs de torneo de 18 dígitos como cadenas. El límite seguro de
JavaScript es menor. En SQLite, aunque una columna `INTEGER` puede almacenar
el valor de 64 bits, el driver lo devuelve como `number` y ya no conserva todos
los dígitos. Esta pérdida no se corrige haciendo `String(number)` después.

El contexto de navegación indexa listas y orígenes directos por
`Map<number,...>` ([`event-navigation-context.ts:28-30`](../../src/bot/state/event-navigation-context.ts#L28)),
de modo que también necesita la referencia completa. El parser solo acepta
IDs numéricos y URLs del locator UVS
([`events.ts:281-294`](../../src/bot/commands/events.ts#L281)).

Los callbacks generados actualmente son largos para la forma Play:

- `event:<18-digit-id>:watch:select:<36-char-UUID>`: 74 bytes observados;
- `watch:replace:<event-id>:<registration-id>:<revision>`: 87 bytes con la revisión actual de 17 caracteres; 102 con una revisión antigua de 32;
- `event:<id>:rounds:round:<id>` tampoco puede asumir que el ID de ronda sea
  decimal.

Telegram limita `callback_data` a 1–64 bytes ([Bot API](https://core.telegram.org/bots/api#inlinekeyboardbutton)).
El tope local de longitud del texto del botón es distinto y el formatter solo recorta ese
texto ([`event-list-formatter.ts:18-59`](../../src/bot/formatters/event-list-formatter.ts#L18)).

### Cambio requerido

Usar strings en todo el dominio y una identidad explícita:

- `EventRef = { provider, id }` para el torneo;
- `PlayerRef`/`RegistrationRef` como strings para UUID o IDs de proveedor;
- `RoundRef` que incluya proveedor, evento, stage/section y clave de ronda;
- el proveedor forma parte de las claves de caché, navegación y persistencia.

Los callbacks deben usar un token compacto. Puede ser un codec reversible
base64url/base36 que incluya la acción, proveedor, ID de evento, ID de jugador
y ronda, o un token corto guardado en una tabla persistente. La elección debe
responder a la supervivencia tras reinicio y a la caducidad de botones. No se
debe truncar un ID ni reducir la revisión hasta provocar colisiones.

Actualizar también:

- `event:list:<id>`, botones de detalle, paginación, rondas y watch;
- el regex de `bot.action` (el registro global ya acepta el prefijo, pero el
  parser interno aún exige dígitos; [`index.ts:226-239`](../../src/index.ts#L226));
- `/events <id>` y `/events <play-url>` manteniendo los IDs como texto;
- `openEventDirectly`, `openEventFromList` y `shouldShowBackToList` para
  `EventRef` completo;
- el enlace de la ficha para `https://playriftbound.com/en-US/events/<id>` y
  conservar el enlace UVS cuando el proveedor sea UVS.

### Aceptación

- `117093196872746571` vuelve a salir exactamente igual después de mapearlo,
  guardarlo, leerlo y formar una URL.
- Todos los callbacks generados se miden con `Buffer.byteLength(data, 'utf8')`
  y son de 1–64 bytes.
- Un callback Play no colisiona con un callback UVS que tenga el mismo texto
  numérico.
- Un botón de selección conserva el UUID del jugador y, tras volver a cargar
  el detalle, selecciona el mismo jugador aunque cambie el orden del roster.
- `/events https://playriftbound.com/en-US/events/<id>` abre el evento sin
  precisión perdida; el formato antiguo del locator conserva su comportamiento
  para eventos UVS.

## 4. Listado y detalle que se muestran al usuario

### Estado observado

`renderEventList` filtra por fin, ordena y guarda la lista en un contexto TTL de
5 minutos ([`events.ts:105-121`](../../src/bot/commands/events.ts#L105)). El
formatter usa `mode`, tienda, capacidad y registro
([`event-list-formatter.ts:39-59`](../../src/bot/formatters/event-list-formatter.ts#L39)).
`normalizeEventMode` solo reconoce las frases con espacios y guion
([`event-listing.ts:3-8`](../../src/core/entities/event-listing.ts#L3)).

La ficha requiere una fecha de fin válida y una zona IANA
([`event-detail-formatter.ts:77-108`](../../src/bot/formatters/event-detail-formatter.ts#L77)).
El modelo exige además tienda numérica, país y zona de la tienda
([`event.ts:20-28`](../../src/core/entities/event.ts#L20)). La búsqueda nueva
puede traer dirección y coordenadas de `organizer`, pero no se ha confirmado
una zona IANA ni todos esos campos.

El coste se representa como `costInCents` y se divide por 100 incluso cuando
la moneda no usa dos decimales ([`event-detail-formatter.ts:55-64`](../../src/bot/formatters/event-detail-formatter.ts#L55)). Play devuelve
`pricing: FREE|PAID`, `entryFee: null` para gratis y `minorUnits` para pagos.

El detalle llama en paralelo a `getEventById` y `getEventRegistrations`, y hace
otra llamada para decidir si hay ronda iniciada
([`events.ts:146-178`](../../src/bot/commands/events.ts#L146)). Si `currentRound`
es `null`, oculta leaderboard y tablas aunque el evento pueda estar en curso
sin una pairing publicada.

### Cambio requerido

El mapper Play debe normalizar explícitamente:

- `PRE_RIFT`, `NEXUS_NIGHT`, `SUMMONER_SKIRMISH` y demás tipos a los modos de
  presentación;
- `participantCapacity` y los recuentos por estado, con un fallback visible
  cuando faltan;
- `startsAt`/`endsAt` UTC. Si no existe zona IANA, mostrar UTC o una zona
  derivada de forma documentada; no inventar `Europe/Madrid` para todos los
  eventos;
- `pricing`/`minorUnits` a un valor de dinero que conserve la moneda y su
  escala. `Intl.NumberFormat` puede determinar los decimales de la moneda;
- `organizer.physicalAddress` a una tienda tolerante a campos ausentes;
- un estado de torneo derivado y separado de la presencia de `currentRound`.

La entidad de listado debe permitir fin desconocido o recibir una proyección
completada desde detalle. Si se desea mostrar duración en la ficha, el detalle
debe ser la fuente de `endsAt`.

### Aceptación

- `PRE_RIFT` muestra el modo Pre-Rift y su icono; `NEXUS_NIGHT` muestra Nexus
  Night; valores desconocidos quedan como Other.
- Un evento gratuito no muestra `0.00` y uno pagado muestra la cifra correcta
  para EUR y para una moneda de escala distinta.
- Un evento Play sin zona IANA no desplaza la hora silenciosamente.
- El detalle puede mostrar nombre, dirección, capacidad y enlace con campos
  opcionales ausentes.
- Un evento en curso sin pairing todavía muestra la ficha y las acciones que
  corresponden al estado derivado, sin depender solo de `currentRound != null`.

## 5. Rondas, leaderboard y pairings

### Estado observado

El dominio representa fases y rondas con IDs numéricos y una lista plana por
fase ([`event.ts:42-56`](../../src/core/entities/event.ts#L42)). El handler ordena
por `orderInPhases` y `roundNumber`, y construye callbacks con `round.id`
([`event-callback.ts:218-249`](../../src/bot/actions/event-callback.ts#L218)).
Para una ronda histórica hace otra llamada por `getEventMatches(round.id)` o
`getEventStandings(round.id)` ([`event-callback.ts:268-300`](../../src/bot/actions/event-callback.ts#L268),
[`event-callback.ts:340-360`](../../src/bot/actions/event-callback.ts#L340)).

Play entrega `stages.sections.rounds` junto con matches y standings del detalle.
La consulta usada no expone un ID de ronda que sea equivalente al `roundId`
UVS documentado por el puerto. La UI expone número y estado, pero dos secciones
pueden repetir el número.

En el detalle real, varios porcentajes de standings llegaron como strings
decimales, aunque el dominio actual declara `number`
([`event-detail.ts:27-36`](../../src/core/entities/event-detail.ts#L27)). Esto
requiere conversión validada (`Number` + `Number.isFinite`) en el mapper; dejar
que un parser permisivo convierta valores inválidos en cero ocultaría un fallo
de contrato.

`EventPairing` solo puede contener dos nombres individuales y exige mesa
numérica ([`event-detail.ts:13-25`](../../src/core/entities/event-detail.ts#L13)).
La evidencia Play incluye `teams[].players[]`, `teamOutcomes` y `byeTeamIds`.
Un bye puede no tener rival ni mesa. Además, en datos reales se observaron
matches `IN_PROGRESS` dentro de una ronda `FINALIZED`; el resultado debe salir
de juegos/outcomes, no solo de `match.status`.

### Cambio requerido

Hay dos diseños válidos para el detalle:

1. Mapear todo el detalle Play a una estructura que contenga cada ronda,
   standings y pairings, y hacer que los métodos históricos lean esa estructura
   cacheada; o
2. Exponer desde el adapter una `RoundRef` compuesta y traducirla a una
   consulta/selección interna sin fingir que es un ID UVS.

En ambos casos, la clave debe incluir `eventRef + stage + section + round` y
no solo `roundNumber`. El orden debe respetar stage/section; no se debe usar el
actual `orderInPhases` como sustituto sin una correspondencia probada.

El modelo de pairing debe representar equipos y jugadores, resultado por
equipo, juegos y bye. Para 1v1 se puede ofrecer una vista compatible con
`player1`/`player2`; para 2v2 el watcher debe localizar al jugador dentro de
su equipo y mostrar los nombres del equipo rival. El mapper debe:

- resolver `WIN`, `LOSS`, `TIE`, `FORFEIT` desde outcomes/games;
- sintetizar una observación `bye` para `byeTeamIds`, aunque no haya mesa;
- conservar match/standing de rondas finalizadas para navegación histórica;
- no marcar pendiente solo porque `match.status` diga `IN_PROGRESS`.

### Aceptación

- Se pueden abrir ronda 1 de Swiss y ronda 1 de Top Cut sin colisión.
- Las flechas de rondas funcionan después de reabrir la ficha y no dependen de
  un cache perdido o de un ID UVS.
- Un 1v1 muestra marcador y resultado correctos cuando la ronda está
  `FINALIZED` aunque el match tenga estado `IN_PROGRESS`.
- Los porcentajes de standings string se convierten a números finitos y un
  valor inválido produce un error de proveedor, no una tabla silenciosamente
  incorrecta.
- Un bye se muestra sin una mesa falsa y produce el resultado `bye` para el
  jugador vigilado.
- Un evento 2v2 no se interpreta como dos jugadores sueltos enfrentados; el
  rival y el resultado se calculan por equipos.

## 6. Watch, lifecycle y compatibilidad de usuarios

### Estado observado

El watch guarda un único `eventId` y un `eventUsername`, y el manager compara
ambos literalmente ([`event-watch-manager.ts:10-14`](../../src/bot/services/event-watch-manager.ts#L10),
[`event-watch-manager.ts:160-179`](../../src/bot/services/event-watch-manager.ts#L160)).
El estado vivo busca `player1/player2` por nombre
([`event-watch-manager.ts:86-100`](../../src/bot/services/event-watch-manager.ts#L86)).
El selector de roster solo acepta registros `Active`
([`event-callback.ts:397-425`](../../src/bot/actions/event-callback.ts#L397)); la
selección vuelve a comprobar el mismo estado y guarda el nombre
([`event-callback.ts:483-517`](../../src/bot/actions/event-callback.ts#L483)).

El watcher agrupa por `eventId` numérico ([`event-watcher.ts:151-173`](../../src/bot/services/event-watcher.ts#L151)),
consulta un solo detalle por evento y compara pairings por nombre
([`event-watcher.ts:281-299`](../../src/bot/services/event-watcher.ts#L281)).
Antes de procesar una pairing, termina el watch si `displayStatus` es complete,
si `eventStatus` es `CANCELLED` o si el registro no está `Active`
([`event-watcher.ts:215-243`](../../src/bot/services/event-watcher.ts#L215)).

Play separa `tournamentRegistrants` de `tournamentParticipants`; el estado de
registro no demuestra que el jugador siga participando. La respuesta observada
incluye participantes `ACTIVE` y `DROPPED`, y el bundle declara también
`ELIMINATED`. El frontend deriva `COMPLETED` de rondas finalizadas y del número
de rondas configurado; no se observó un estado público equivalente a
`CANCELLED` en la consulta usada.

### Cambio requerido

Guardar una identidad estable del jugador, idealmente `player.id`, además del
nombre mostrado. El selector puede enseñar `displayName#tagLine`, pero el
watcher debe unir participantes, registros y pairings por ID. El nombre solo
debe ser una etiqueta de presentación y fallback para watches UVS antiguos.

Antes de empezar, la vista debe permitir seleccionar inscritos `REGISTERED` según la política de inscripción, aunque aún no exista `tournamentParticipant`. Debe distinguir espera de plaza (`WAITLISTED`), no inscrito y estado desconocido. Cuando exista participación, el adapter debe usar el estado de participante para decidir si sigue activo. La ausencia temporal de una fila de participante no equivale a `DROPPED`. Hay que decidir y probar si `ELIMINATED` termina un
watch o solo genera una notificación; `DROPPED` debe tener un comportamiento
definido.

El ciclo de una ronda final debe ser:

1. mapear y comparar la última pairing/bye/result;
2. enviar la notificación de resultado si cambió;
3. registrar el snapshot y la salud;
4. enviar la notificación terminal de evento completado o jugador retirado;
5. borrar el watch de forma revision-guarded.

No se debe tratar un detalle ausente como cancelación. La consulta Play que
devuelve una lista vacía para un ID desconocido puede convertirse en `null` y
usar la tolerancia de tres ausencias actual, pero `BAD_REQUEST`,
`PERSISTED_QUERY_NOT_IN_LIST`, headers ausentes o un error de esquema deben ser
fallos del proveedor y conservar el watch.

El watcher debe agrupar por `provider:eventId`, no por el número aislado. Si se
conservan watches UVS, una lista de watches antiguos debe seguir consultando
UVS o recibir una migración de usuario explícita. No hay datos para convertir
automáticamente el nombre/ID de un watch UVS al UUID Play.

### Aceptación

- Un cambio de `displayName` no rompe el watch si `player.id` no cambia.
- Un jugador `REGISTERED` sin participante no aparece como activo sin una
  regla explícita; un participante `ACTIVE` sí puede seleccionarse.
- `DROPPED` y `ELIMINATED` siguen la política acordada y tienen test de
  notificación/borrado.
- La última pairing y su resultado se notifican antes del mensaje terminal.
- Un bye genera una notificación y actualiza `lastSeenResult: 'bye'`.
- Dos watches del mismo evento Play hacen una sola consulta; un evento Play y
  uno UVS con un ID numéricamente igual hacen dos consultas correctas.
- Un error de contrato GraphQL no incrementa `consecutiveMissing` ni borra un
  watch después de tres ciclos.

## 7. SQLite, revisiones y despliegue gradual

### Estado observado

`004_event_watches.sql` crea `event_id INTEGER` y no guarda proveedor ni
identidad del jugador ([`004_event_watches.sql:8-22`](../../src/infrastructure/persistence/migrations/004_event_watches.sql#L8)).
`005_event_watch_health.sql` añade revisión, salud y `has_observed_pairing`,
pero deja el tipo y la clave de evento intactos
([`005_event_watch_health.sql:4-16`](../../src/infrastructure/persistence/migrations/005_event_watch_health.sql#L4)).
El repositorio prepara statements con `number` para evento y jugador
([`sqlite-event-watch-repository.ts:58-73`](../../src/infrastructure/persistence/sqlite-event-watch-repository.ts#L58)).
Las migraciones se aplican una vez y en orden por nombre
([`open-database.ts:26-53`](../../src/infrastructure/persistence/open-database.ts#L26)).

Las revisiones nuevas generadas por el repositorio son compactas
([`sqlite-event-watch-repository.ts:31-35`](../../src/infrastructure/persistence/sqlite-event-watch-repository.ts#L31)),
pero las revisiones antiguas creadas por la migración pueden tener 32
caracteres. La revisión sola cabe en `watch:stop`; el problema principal es
combinarla con ID de evento y UUID en `watch:replace`.

### Cambio requerido

Añadir una migración posterior que reemplace o reconstruya la tabla para usar
texto en IDs y una identidad explícita, por ejemplo:

```text
telegram_id       INTEGER PRIMARY KEY
provider          TEXT NOT NULL
event_id          TEXT NOT NULL
player_id         TEXT
registration_id   TEXT
event_name        TEXT NOT NULL
event_username    TEXT NOT NULL
...
```

La migración debe copiar los watches existentes como `provider = 'uvs'` y
`event_id = CAST(event_id AS TEXT)` desde la columna antigua, antes de que un
driver los convierta a `number`. Los valores viejos conservan el matching por
nombre si no existe `player_id`; no se deben presentar como watches Play
convertidos automáticamente.

La identidad única de agrupación no debe ser solo `event_id`. El índice puede
ser `(provider, event_id)`. `telegram_id` sigue siendo un entero porque es un
ID de Telegram y no forma parte del problema de precisión Play.

La migración debe ser compatible con SQLite en producción: cambiar una
afinidad no basta para corregir el valor ya leído como número; normalmente se
requiere crear tabla nueva, copiar, renombrar y recrear índices dentro de una
transacción. Añadir tests con una base de datos en memoria y un valor Play de
18 dígitos evita una regresión silenciosa.

### Aceptación

- Un watch UVS existente sobrevive la migración, conserva exactamente su ID y
  se consulta por UVS.
- Un watch Play recién creado conserva exactamente el ID de torneo y UUID de
  jugador tras cerrar/abrir SQLite.
- `list`, `get`, `replace`, `deleteIfCurrent` y `recordObservation` mantienen
  la protección por revisión.
- La base contiene proveedor e ID de texto; ningún statement de eventos usa
  `number`.
- Las pruebas ejecutan todas las migraciones reales en `:memory:` y cubren un
  esquema legado con datos.

## 8. Errores, retries y health del watcher

### Estado observado

`fetchWithRetry` solo reintenta excepciones de red/abort y no respuestas HTTP
no exitosas ([`api-client.ts:6-23`](../../src/utils/api-client.ts#L6)). El
watcher clasifica como transitorio `ApiTimeoutError` y mensajes de
`ApiResponseError` que contengan `5xx`
([`event-watcher.ts:110-113`](../../src/bot/services/event-watcher.ts#L110)).
Un `null` del repositorio se registra como ausencia y a la tercera ausencia se
notifica “event could not be found” y se borra el watch
([`event-watcher.ts:192-211`](../../src/bot/services/event-watcher.ts#L192)).

En GraphQL, HTTP 200 con `errors` es posible. El ID incorrecto probado devuelve
`data.competeTournaments: []` y debe significar “no encontrado”; un ID mal
formado devuelve `data: null` con `BAD_REQUEST` y debe ser error de contrato.
El hash obsoleto devuelve 404 `PERSISTED_QUERY_NOT_IN_LIST`, y omitir los headers
Apollo devuelve 401. Ninguno de esos casos debe convertirse en tres
ausencias.

### Cambio requerido

El adapter Play debe exponer errores tipados con servicio, HTTP status y código
GraphQL. El watcher debe distinguir al menos:

- timeout/network/5xx: transitorio, incrementa fallos y conserva watch;
- detalle vacío para un ID válido: no encontrado, aplica la política de tres
  ausencias;
- `BAD_REQUEST`, `PERSISTED_QUERY_NOT_IN_LIST`, `UNAUTHENTICATED`, headers o
  schema: error de configuración/contrato, conserva watch y emite log/health;
- evento completado o participante retirado: terminal de dominio, procesa
  snapshot y después borra.

Conviene centralizar la versión de cliente Apollo y hashes en constantes
configurables y registrar una alerta clara cuando el proveedor los cambie. No
se deben reintentar consultas inválidas con backoff, porque eso multiplica el
tiempo de resolución y puede causar borrado por ausencia si el clasificador
queda mal conectado.

### Aceptación

- Los errores GraphQL de HTTP 200 se prueban sin depender del status HTTP.
- 401/404 de contrato no reintentan ni borran watches.
- Timeout y 5xx dejan `consecutiveFailures` y permiten recuperación posterior.
- El detalle vacío para un ID válido incrementa `consecutiveMissing` y solo
  termina el watch tras la tercera observación real.
- Un log incluye proveedor, operación y código, sin filtrar tokens secretos.

## 9. Funciones que no dependen directamente de esta migración

`/mytable` usa `NexusTableAdapter` y la configuración de Nexus por separado
([`index.ts:96-102`](../../src/index.ts#L96), [`config.ts:48-52`](../../src/config.ts#L48)).
Cartas, consultas inline, preferencias de ubicación y el flujo de compartir
coordenadas no llaman al proveedor de eventos. Cambiar `/events` no garantiza
que Nexus localice torneos Play: esa compatibilidad queda **no resuelta** y
requiere una prueba del API de Nexus si se pretende anunciarla.

La ubicación guardada sí se puede conservar; lo que cambia es la unidad que se
envía al adapter de eventos. Los datos de usuario no necesitan una migración
por esta causa.

## Orden recomendado de implementación

1. Fijar el contrato `EventRef`, `PlayerRef` y `RoundRef`: Riot para eventos nuevos, UVS separado para referencias históricas y filas existentes, sin fallback operativo a UVS.
2. Añadir migración SQLite y callbacks compactos antes de generar botones Play.
3. Implementar el cliente GraphQL con validación de `errors`, cursor, metros,
   IDs de texto y clasificación de errores.
4. Implementar mappers de listado y detalle, incluidos dinero, fechas, estados,
   participantes, rounds/stages, teams, outcomes y byes.
5. Conectar el adapter por proveedor en `index.ts` y actualizar enlaces,
   comandos directos y navegación.
6. Adaptar watcher/manager/diff y cerrar el ciclo de resultado final antes del
   terminal.
7. Ejecutar las pruebas de aceptación anteriores y una prueba real de lectura
   pública sin crear watches ni enviar mensajes.

No se debe desplegar un cambio que solo sustituya `RiftfoundEventsAdapter`:
dejaría los IDs nuevos entrando en un repositorio de detalle UVS y mantendría
sin resolver la precisión, los callbacks, el roster y la persistencia.


## Comprobaciones adicionales reproducidas en esta auditoría

Estas comprobaciones son de lectura. No se crearon watches reales, no se enviaron mensajes de Telegram y no se modificó la base de datos de producción.

| Comprobación | Resultado observado |
|---|---|
| [Riftfound: Sevilla, 80 km, 16–23 octubre, calendarMode](https://www.riftfound.com/api/events?calendarMode=true&startDateFrom=2026-10-16T00%3A00%3A00Z&startDateTo=2026-10-23T00%3A00%3A00Z&lat=37.39&lng=-5.99&radiusKm=80&page=1) | HTTP 200; 32 IDs únicos, 26 empiezan a partir del 17 de octubre. Cada página incluye los mismos 32, con `pagination.limit=20`, `total=32`, `totalPages=2`. No es solo una diferencia entre eventos ya terminados y futuros. |
| `RiftfoundEventsAdapter.getEvents` compilado, contra esa consulta | `ApiResponseError`, 502 interno de validación, `invalid_format` en `data[0].externalId`; no es un 502 HTTP del servidor. `endDate: null` también es incompatible con el schema actual. |
| `RiftboundV2Adapter.getEvents` compilado, mismas fechas, coordenadas y radio equivalente | Cero eventos. Por tanto el fallback oculta el fallo con una lista vacía. |
| `GetCompeteTournamentForRiftboundPlayer`, ID numérico válido pero inexistente `999999999999999999` | HTTP 200, `data.competeTournaments: []`, sin `errors`. |
| Misma operación, ID `not-a-tournament` | HTTP 200, `data: null`, `errors[].extensions.classification = BAD_REQUEST`. Es distinto de un evento inexistente. |
| `CompeteTournamentSearch`, `sortBy.rb=DATE`, Sevilla 80 km | HTTP 200, 20 resultados ordenados por inicio y `hasNextPage: true`. El objeto `tournament` no incluye `endsAt`. La parada por fecha requiere pedir este orden explícitamente. |
| ID `117093196872746571` pasado por `Number` | Se convierte a `117093196872746580`; `Number.isSafeInteger` devuelve false. |
| Mismo ID insertado como string en un SQLite en memoria con columna `INTEGER` | SQLite conserva el entero exacto (`CAST AS TEXT` devuelve el original), pero la lectura predeterminada de better-sqlite3 entrega el número redondeado. `TEXT` desde el origen evita esa conversión. |
| Callbacks generados con UUID de inscripción real y revisiones creadas por el repositorio actual en SQLite en memoria | Selección: 74 bytes. Reemplazo con revisión actual: 87 bytes. Reemplazo con revisión antigua de 32 caracteres: 102 bytes. |
| Unión de identidades del detalle público de Júpiter | Los 8 `player.id` de matches enlazan con los 8 participantes y los 8 inscritos. No hace falta hacer matching por nombre para este evento. Los porcentajes de standings llegaron como strings. |
| Normalizador actual con enums Play | `PRE_RIFT` y `NEXUS_NIGHT` dan `Other`; `SUMMONER_SKIRMISH` sí da `Skirmish`. |

El detalle de Júpiter y sus consultas se describen en el [informe de proveedor](events-provider-2026-10.md#detalle-de-evento). Las formas de datos proceden del [fragmento público del frontend](https://events.playriftbound.com/_next/static/chunks/2kd-_vtq5am73.js) y del [manifiesto de operaciones](https://events.playriftbound.com/_next/static/chunks/3nzz3d32kaukt.js), además de las respuestas HTTP probadas.

### Rendimiento, operación y límites que también hay que cerrar

- Unificar las lecturas de la ficha: `renderEventDetail` pide evento y registros en paralelo y después el bundle. Un adapter que repita la descarga GraphQL por cada método multiplicaría las consultas. Compartir una descarga en curso y una caché breve por `EventRef`; obtener el organizador solo cuando haga falta. Una ronda histórica no debe lanzar otra descarga por cada ronda vacía.
- Conservar `fresh` para watcher y refresh manual. Definir si actualiza la caché: la implementación V2 actual evita leerla con `fresh`, pero sigue escribiéndola; el comentario del puerto dice que no escribe. Resolver esta discrepancia al fijar el nuevo contrato.
- El poller `updatedAt` es una optimización posterior: hay que mantener el snapshot, la primera lectura y los metadatos de salud incluso si no hay cambios. No se ha verificado que ese timestamp cambie ante todas las operaciones relevantes; hasta entonces no debe ser la única señal que permite refrescar el detalle.
- Tratar 429/`Retry-After` y errores transitorios GraphQL como fallos recuperables. El `fetchWithRetry` actual no reintenta respuestas HTTP y el watcher solo reconoce algunos 5xx por el texto de un mensaje. El clasificador necesita datos estructurados y no debe lanzar un bucle de reintentos ante hashes inválidos. Los límites de uso de Riot no se han determinado en esta investigación.
- Guardar `RoundRef` en el snapshot del watch, no solo `lastSeenRound`: dos stages pueden tener ronda 1 con la misma mesa y rival, y el diff actual no detectaría esa transición. Guardar identidad del rival/equipo evita avisos falsos cuando cambia su nombre.
- En formato 2v2, ampliar el modelo o mostrar explícitamente que ese flujo no está soportado. No aplanar silenciosamente equipos como jugadores individuales. La compatibilidad real 2v2 sigue sin probarse.
- Conservar la revisión y el propietario al resolver callbacks compactos. Probar botones antiguos UVS, botones caducados, reinicio, selección de roster cambiado y reemplazo concurrente; un token opaco en memoria no conserva por sí solo la duración de los botones actuales.
- Crear una migración SQL nueva; no editar las ya aplicadas. Probar una base con esquema y watches anteriores. Un rollback al código antiguo no entenderá necesariamente filas nuevas Play: definir la vuelta atrás con copia consistente de SQLite o despliegue compatible. El kill switch de polling no sustituye esta comprobación.
- Mantener cancelación, conflicto entre reportes y subtipo de empate como desconocidos si la consulta no los expone. No inventar estados equivalentes a UVS. El criterio de finalización copiado del frontend debe probarse con varias fases; el ejemplo Swiss simple no confirma una finalización correcta en todos los formatos.
- Añadir configuración y documentación para el proveedor/operaciones: `src/config.ts`, `.env.example`, `README.md` y wiring. No hace falta un token Riot para las lecturas públicas probadas. `NEXUS_WATCHER_*` controla actualmente el watcher de eventos, a pesar del nombre; preservarlo o añadir aliases para no perder la configuración existente.

### Pruebas que faltan para afirmar que la migración conserva el comportamiento

La suite actual pasó **35 archivos / 316 tests**, y `npm run build` terminó correctamente. Es una línea base: las respuestas simuladas no contienen los cambios reales del proveedor, por lo que no demuestra compatibilidad con PlayRiftbound.

Antes de activar el proveedor deben existir fixtures representativas y anonimizadas (inscritos aún sin participantes, torneo activo, ronda finalizada con match `IN_PROGRESS`, bye, retirada, varias fases y respuesta incompleta). Los tests deben atravesar el adapter y los flujos de comandos/callbacks/watch, incluyendo:

1. listado real → detalle → roster → alta → SQLite → reinicio → refresh;
2. polling de nueva ronda, cambio de rival/mesa, resultado corregido y resultado final antes de terminar;
3. ronda finalizada anterior con standings cuando la actual aún no los tiene;
4. error HTTP/GraphQL/429 o hash cambiado sin borrar la suscripción;
5. precisión de IDs y tamaño de todos los callbacks;
6. conservación de watches UVS y aislamiento entre proveedores;
7. respuesta parcial, tipos desconocidos y estados no soportados sin inventar resultados;
8. lectura pública real y, después de implementar, una prueba autorizada en Telegram del flujo Watch completo. Las comprobaciones de esta investigación no son esa prueba de extremo a extremo.

## Cierre de investigación: `/mytable` y búsqueda de identidad

La funcionalidad publicada de `/mytable` incluye consulta por nombre guardado, consulta puntual `/mytable <username>`, guardar nombre y borrarlo. Su adaptador llama al [endpoint Nexus](https://riftboundtoolkit.netlify.app/.netlify/functions/nexus-table?action=status&username=riftbot-audit-nonexistent), no directamente a UVS.

En esta ampliación, el endpoint devolvió HTTP 200 con `event`, `round`, `table` y `standings` nulos y el mensaje `No event found for today at the selected store`. Se repitió con el nombre público de un inscrito del detalle Riot comprobado y devolvió la misma respuesta. **No demuestra que Nexus esté caído ni que soporte los torneos nuevos**: el mensaje puede depender de la tienda y fecha que consulta el servicio. No se debe presentar como una migración ya resuelta.

Se probó la operación pública registrada `PlayerTournaments` de Riot, hash `325210614006360e6f6bda3de390704e7f974f16f4d20361a1a3f29fb2101fd7`, con variables `{ "pastFirst": 1, "upcomingFirst": 1 }`, las cabeceras Apollo y sin sesión. Respondió HTTP 200 con `data: null` y `errors[].extensions.classification: UNAUTHENTICATED`. El mensaje fue `The player is not authenticated`. El cuerpo del manifiesto no acepta un nombre de usuario arbitrario: solo paginación de torneos pasados/futuros del jugador autenticado. `GetPlayer` tampoco sustituye ese lookup: consulta `pickemPlayer`, no la identidad de un participante de Compete.

La vía pública demostrada para localizar mesa y resultado es **evento conocido + `player.id` estable**: el detalle contiene el roster, los equipos y sus matches. Puede alimentar `/mytable` a partir de una selección explícita del jugador/evento (un watch puede observar a otra persona y no debe usarse como identidad propia automáticamente) y conservar los campos mesa, rival, ronda y standings. Eso requiere guardar la identidad elegida y modificar las ayudas de nombre/validación (`nexus-username.ts` no admite actualmente el separador `#` de Riot ID).

**Actualización posterior:** no se ha demostrado un lookup global por nombre, pero ese tampoco era el contrato real de la web Nexus: requiere `store_id`, que el bot omite. Se ha probado una ruta pública por tienda/día/nombre en Riot, descrita en el informe de huecos de paridad. Las limitaciones de este párrafo se refieren al caso sin tienda ni evento. Recorrer rosters cercanos es una alternativa de alcance limitado, con ambigüedad de nombres, coste y cobertura geográfica distintos; no cuenta como conservación exacta del lookup actual. La aprobación de una integración oficial autenticada tampoco está implícita en que una sesión de la web tenga acceso: no se deben copiar cookies ni credenciales de Riot al bot.

**Criterio para poder afirmar paridad:** `/mytable` debe obtener mesa/rival/resultado de un torneo Riot real para el jugador seleccionado, conservar `set`/`clear` y el lookup puntual, resolver ambigüedad sin elegir otro jugador y cubrir el caso sin watch activo. La selección inicial de tienda y los casos de varios eventos/jugadores deben quedar cubiertos por el diseño comprobado por tienda; un lookup global sin contexto no debe introducirse como requisito supuesto del proveedor antiguo. Mantener Nexus sin cambios conserva el código de ese comando; no demuestra su cobertura de la nueva plataforma.

## Callback compacto: prueba de viabilidad sin tabla de tokens

Se ejecutó una prueba aislada de codificación/decodificación, sin modificar handlers. El formato candidato `wpr:<eventId-base36>:<registrationUUID-base64url>:<revision>` reserva el prefijo para Watch/Play/Replace. Convierte IDs exclusivamente con `BigInt` y conserva revisiones antiguas de 32 dígitos hexadecimales como bytes en base64url; las revisiones actuales de 17 caracteres usan un marcador de tipo y su texto original.

- ID real de 18 dígitos + UUID + revisión actual: **57 bytes**.
- Entero máximo unsigned de 64 bits (`18446744073709551615`) + UUID + revisión antigua de 32 caracteres: **64 bytes**.
- Las tres identidades recuperadas coincidieron exactamente con las originales en ambos casos.

Esto demuestra que el límite de Telegram es resoluble sin truncar IDs, sin reducir revisiones y sin introducir necesariamente un almacenamiento de tokens. No prueba que todos los formatos futuros de ID quepan. El codec de producción debe validar el formato de origen, fallar de manera explícita ante una longitud superior, mantener el proveedor y acción en la versión del protocolo y probar por separado cada callback de rondas, selección, reemplazo y administración. La decodificación base36 debe usar `BigInt` carácter a carácter; `parseInt` volvería a perder precisión.

Los botones existentes UVS y las revisiones guardadas deben seguir decodificándose durante la transición. La resolución del token no sustituye las comprobaciones actuales de chat privado, propietario, permisos de administrador y revisión vigente.

### Discrepancia existente en el parser de `/mytable`

La ayuda anuncia `/mytable <username>`, pero `parseAction` en `src/bot/commands/mytable.ts` solo reconoce argumento vacío, `show`, `set` o `clear`. Una prueba aislada del handler compilado con contexto simulado confirmó que `/mytable audit-user` devuelve `Usage` sin llamar al repositorio, mientras que `/mytable show audit-user` sí llega al lookup. No se hizo una petición externa en esta prueba.

Al sustituir el proveedor se debe cubrir y conservar la funcionalidad publicada: nombre guardado, `set`, `clear`, lookup puntual y manejo de múltiples coincidencias. Esa conservación necesita corregir también el parser; no basta con que el puerto nuevo se parezca al antiguo. La prueba de aceptación debe comprobar ambos formatos y las identidades Riot con `#tagLine`.

## Referencias de cierre y alcance de la garantía

El [informe de huecos de paridad](events-api-parity-gaps-2026-10.md) comprueba cancelación, conflicto/subtipo de empate, varias fases, equipos y alternativas de consulta de jugador. El catálogo GraphQL genérico `tournaments` no devolvió el torneo de muestra al consultarlo por el mismo ID Play; su campo `state` no es una señal de cancelación demostrada para ese torneo.

La investigación demuestra una ruta de implementación para listado, detalle, roster, rondas, leaderboard y Watch 1v1, y una solución de precisión/persistencia/callbacks. No demuestra todavía preservación literal del **100 %** de las señales antiguas. La cancelación explícita y el conflicto/subtipo de empate necesitan una fuente adicional o una integración autorizada y documentada; para `/mytable` hay una ruta pública por tienda/día/jugador comprobada en un torneo real, con selección inicial de tienda y casos múltiples todavía por implementar/probar; la compatibilidad 2v2/multifase necesita muestras y pruebas más amplias. Marcar esos casos como desconocidos evita inventar datos, pero no cuenta como paridad completa.

## Corrección del alcance de `/mytable`: tienda requerida por Nexus

El [frontend de Nexus](https://riftboundtoolkit.netlify.app/assets/index-CwWfBzOP.js) valida una tienda seleccionada y envía `store_id` además de `username`. El bot omite ese parámetro. La respuesta previa `No event found for today at the selected store` no demostraba la imposibilidad de reemplazar la función: se estaba probando una petición sin el contexto que usa la propia web.

Se comprobó una alternativa con la API Riot: búsqueda geográfica junto a una tienda, filtro por `organizer.id` y día, lectura del roster, resolución por nombre/tagline a UUID, y unión por equipo con las mesas y standings. Con Júpiter se obtuvo una coincidencia, ronda 3, mesa, rival, victoria y registro W/L/D. Los detalles están en [huecos de paridad](events-api-parity-gaps-2026-10.md#mytable-y-la-identidad-de-jugador).

Implementación necesaria: añadir una preferencia de tienda/organizador y de jugador de consulta independiente de Watch; permitir la selección inicial explícita; conservar `set`, `clear`, consulta guardada y puntual; desambiguar varios eventos/jugadores; corregir el parser; probar fechas en la zona de la tienda, eventos completados/activos y ausencia de pairing. Esta configuración inicial repara el contexto que el bot no guardaba; no es una sustitución silenciosa por el jugador vigilado.

No hay una correspondencia pública verificada entre un `store_id` numérico Nexus y un UUID de organizador Riot. La migración debe pedir elección si no hay un vínculo seguro, en lugar de enlazar tiendas solo por su nombre.
