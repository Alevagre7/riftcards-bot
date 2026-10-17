// IUserSettingsRepository is the port for per-TelegramUser settings:
// /events location, /mytable player name, and /mytable store selection.
// The SQLite adapter persists each setting independently so changing a
// store or player name does not affect the user's event-search location.

export interface UserLocation {
  readonly telegramId: number;
  readonly latitude: number;
  readonly longitude: number;
  // null = use the global EVENTS_RADIUS_KM env default. The location
  // setup flow stores the configured default explicitly; null remains
  // available for callers that want to opt back into the global value.
  readonly radiusKm: number | null;
  readonly updatedAt: string;
}

/** A Riot organizer explicitly selected for the user's /mytable lookup. */
export interface MytableStorePreference {
  readonly organizerId: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  /** IANA timezone used to select events on the store's local calendar day. */
  readonly timezone: string;
  readonly updatedAt: string;
}

export interface IUserSettingsRepository {
  getLocation(telegramId: number): Promise<UserLocation | null>;
  setLocation(
    telegramId: number,
    location: { latitude: number; longitude: number; radiusKm?: number | null },
  ): Promise<void>;
  clearLocation(telegramId: number): Promise<void>;

  getNexusUsername(telegramId: number): Promise<string | null>;
  setNexusUsername(telegramId: number, username: string): Promise<void>;
  clearNexusUsername(telegramId: number): Promise<void>;

  getMytableStore(telegramId: number): Promise<MytableStorePreference | null>;
  setMytableStore(
    telegramId: number,
    store: Omit<MytableStorePreference, 'updatedAt'>,
  ): Promise<void>;
  clearMytableStore(telegramId: number): Promise<void>;
}
