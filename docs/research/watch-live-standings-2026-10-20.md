# Watch: rondas sin clasificación publicada

El usuario observó el domingo 18 de octubre una única notificación de ronda, seguida inmediatamente por el cierre del seguimiento. La captura corresponde al torneo Riot `117095971017879133`.

Los logs conservados registran la selección del jugador a las 08:02 UTC. Entre las 08:34:47 y las 10:19:50 UTC aparecen 211 errores de validación del mismo torneo, aproximadamente cada 30 segundos. El error apunta a `stages[0].sections[0].rounds[0].endOfRoundStandings`, donde el esquema esperaba un array. El sondeo continuaba y conservaba el watch, pero rechazaba el detalle completo y no procesaba las mesas.

La validación exigía una clasificación publicada para poder leer el torneo. El campo puede ser nulo mientras la ronda sigue en curso. La prueba de regresión reproduce ese caso y comprueba las notificaciones desde el adaptador HTTP, pasando por SQLite y el watcher. Antes del cambio falla en la primera ronda: esperaba una notificación y recibe cero. Después del cambio entrega las rondas 1, 2 y 3, el resultado final y el aviso de cierre.

La corrección acepta exclusivamente un `null` explícito como clasificación aún no disponible y lo normaliza a una colección vacía. Los campos ausentes, valores de otro tipo y errores GraphQL siguen rechazándose. No cambia la interpretación de las partidas, los resultados ni la finalización del evento.

Una lectura directa posterior de Riot devuelve ese torneo terminado, con tres rondas, ocho jugadores y cuatro emparejamientos de la última ronda. No se conservaron cuerpos HTTP del periodo del incidente: la evidencia histórica es el error de validación y su ruta, no una captura completa de cada respuesta.

Para el viernes 16 de octubre no hay logs conservados: el contenedor actual se creó el sábado 17. No se atribuye ese caso al mismo defecto sin evidencia adicional.

Reproducción: `npx vitest run src/infrastructure/apis/playriftbound-watch.integration.test.ts -t 'notifies each live round'`.
