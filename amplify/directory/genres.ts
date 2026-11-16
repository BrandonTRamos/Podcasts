/**
 * The genres the directory's charts can be browsed by. The schema's
 * `DirectoryGenre` enum lists the same names, and the client labels them.
 */
export const DIRECTORY_GENRES = [
  'arts',
  'business',
  'comedy',
  'education',
  'fiction',
  'government',
  'healthFitness',
  'history',
  'kidsFamily',
  'leisure',
  'music',
  'news',
  'religionSpirituality',
  'science',
  'societyCulture',
  'sports',
  'technology',
  'trueCrime',
  'tvFilm',
] as const

export type DirectoryGenre = (typeof DIRECTORY_GENRES)[number]

/** Each genre's ID in Apple's directory: its top-level podcast genres. */
export const APPLE_GENRE_IDS: Record<DirectoryGenre, string> = {
  arts: '1301',
  business: '1321',
  comedy: '1303',
  education: '1304',
  fiction: '1483',
  government: '1511',
  healthFitness: '1512',
  history: '1487',
  kidsFamily: '1305',
  leisure: '1502',
  music: '1310',
  news: '1489',
  religionSpirituality: '1314',
  science: '1533',
  societyCulture: '1324',
  sports: '1545',
  technology: '1318',
  trueCrime: '1488',
  tvFilm: '1309',
}
