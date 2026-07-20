// IUserSettingsRepository is the port for per-TelegramUser
// persistent settings. The first setting stored is the user's
// location, used by the /events command. Future per-user features
// (favourites, history, /new filters) may add new port methods or a
// new repository. See ADR-0006.

export interface UserLocation {
  readonly telegramId: number;
  readonly latitude: number;
  readonly longitude: number;
  // null = use the global EVENTS_RADIUS_KM env default. The v1
  // /events set flow only writes a null radius; per-user radius
  // override is a future feature (see ADR-0006 → "Given up: full
  // statelessness → deferred backup").
  readonly radiusKm: number | null;
  readonly updatedAt: string;
}

export interface IUserSettingsRepository {
  getLocation(telegramId: number): Promise<UserLocation | null>;
  setLocation(
    telegramId: number,
    location: { latitude: number; longitude: number; radiusKm?: number | null },
  ): Promise<void>;
  clearLocation(telegramId: number): Promise<void>;
}
