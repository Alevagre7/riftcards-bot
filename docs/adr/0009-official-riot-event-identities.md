# Official Riot event identities and 1v1 tracking

New events and live tournament data use Riot's public PlayRiftbound GraphQL endpoint directly. Aggregators cannot guarantee the freshness required for pairing notifications. UVS references keep their original provider and never act as fallback results for a failed Riot request.

Riot event IDs exceed JavaScript's safe integer range. Event references preserve the provider and decimal text, player tracking uses the stable Riot player UUID, and round references include tournament, stage, section, and round. SQLite migrations preserve legacy watches and revisions. Callback encodings preserve those identities within Telegram's 64-byte limit.

The initial scope is 1v1. Team formats remain visible but player tracking is disabled until a dedicated model and fixtures exist. Unknown cancellation, report conflict, and draw subtype remain unknown instead of borrowing unverified semantics from a community normalizer.

This updates ADR-0007's provider-specific assumption that player registrations require a separate upstream endpoint. The bot retains separate repository methods, but Riot's detail bundle supplies registrations and tournament state together.
