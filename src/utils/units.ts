// Unit conversion helpers used across the bot. The upstream events
// API takes a radius in statute miles; the bot's env-var contract
// uses kilometres (matching the rest of the project). Doing the
// conversion at one well-named location keeps the call sites honest.

// KM_PER_MILE is the canonical kilometres-per-statute-mile factor.
// 1 statute mile = 1.609344 km exactly. The inverse (1 km = 0.621371
// mi) is the value the bot actually uses when converting the env
// config (km) to the upstream's expected miles. Keep the long
// literal; do not truncate to 0.62.
export const KM_PER_MILE = 0.621371;

// MILES_PER_KM is the inverse of KM_PER_MILE. Used by the riftfound
// adapter which takes radius in km (the bot internally works in miles
// via EventLocation.numMiles).
export const MILES_PER_KM = 1 / KM_PER_MILE;

export function kmToMiles(km: number): number {
  return km * KM_PER_MILE;
}

export function milesToKm(miles: number): number {
  return miles * MILES_PER_KM;
}
