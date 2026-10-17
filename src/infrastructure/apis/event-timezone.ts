import timezoneLookup from '@photostructure/tz-lookup';

/** Derive an IANA zone locally from the official store coordinates. */
export function eventTimezone(latitude: number, longitude: number): string {
  try {
    const zone = timezoneLookup(latitude, longitude);
    // Use only zones that this Node/ICU installation can render.
    new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format();
    return zone;
  } catch {
    return 'UTC';
  }
}
