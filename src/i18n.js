// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, action result). Every
// text is a { en, fr } object: Gladys picks the user's language. None of
// them ever holds the security token.
// -----------------------------------------------------------------------------

const at = (t, timezone) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(t));

export const T = {
  starting: { en: 'Reading the ENTSO-E prices…', fr: 'Lecture des prix ENTSO-E…' },
  noToken: {
    en: 'Enter your ENTSO-E security token in the configuration (see the guide to get a free one).',
    fr: 'Saisissez votre jeton de sécurité ENTSO-E dans la configuration (le guide explique comment en obtenir un gratuitement).',
  },
  malformedToken: {
    en: 'The security token does not look like an ENTSO-E token (letters, digits and dashes): check the configuration.',
    fr: 'Le jeton de sécurité ne ressemble pas à un jeton ENTSO-E (lettres, chiffres et tirets) : vérifiez la configuration.',
  },
  refused: {
    en: 'ENTSO-E refused the security token (401). Readings are stopped: check the token, or that ENTSO-E enabled API access for your account, then save the configuration or press "Read the prices now".',
    fr: "ENTSO-E a refusé le jeton de sécurité (401). Les lectures sont arrêtées : vérifiez le jeton, ou qu'ENTSO-E a bien activé l'accès à l'API pour votre compte, puis enregistrez la configuration ou appuyez sur « Lire les prix maintenant ».",
  },
  paused: (until, timezone) => ({
    en: `ENTSO-E asked to slow down: next reading at ${at(until, timezone)}.`,
    fr: `ENTSO-E a demandé de ralentir : prochaine lecture à ${at(until, timezone)}.`,
  }),
  unreachable: (message, next, timezone) => ({
    en: `No price yet: ${message}. Next attempt at ${at(next, timezone)}.`,
    fr: `Pas encore de prix : ${message}. Nouvel essai à ${at(next, timezone)}.`,
  }),
  stale: (message, next, timezone) => ({
    en: `Showing the last prices read; ${message}. Next attempt at ${at(next, timezone)}.`,
    fr: `Affichage des derniers prix lus ; ${message}. Nouvel essai à ${at(next, timezone)}.`,
  }),
  noData: (zone) => ({
    en: `ENTSO-E publishes no day-ahead price for ${zone} today: check the zone in the configuration.`,
    fr: `ENTSO-E ne publie aucun prix du lendemain pour ${zone} aujourd'hui : vérifiez la zone dans la configuration.`,
  }),
  ok: (zone, tomorrow) => ({
    en: `Prices of ${zone} for today${tomorrow ? ' and tomorrow' : ' (tomorrow after 13:00 CET)'}.`,
    fr: `Prix de ${zone} pour aujourd'hui${tomorrow ? ' et demain' : ' (demain après 13 h, heure de Bruxelles)'}.`,
  }),
  report: ({ zone, current, avg, rank, tomorrow }) => ({
    en: `ENTSO-E OK for ${zone}: ${current} EUR/kWh now (rank ${rank}, 0 = cheapest), ${avg} on average today; tomorrow ${tomorrow ? 'published' : 'not published yet'}.`,
    fr: `ENTSO-E OK pour ${zone} : ${current} EUR/kWh maintenant (rang ${rank}, 0 = le moins cher), ${avg} en moyenne aujourd'hui ; demain ${tomorrow ? 'publié' : 'pas encore publié'}.`,
  }),
};

/** A short, token-free reason for an EntsoeError, in both languages. */
export function reasonOf(err) {
  const reasons = {
    timeout: { en: 'ENTSO-E did not answer in time', fr: "ENTSO-E n'a pas répondu à temps" },
    network: { en: 'ENTSO-E is unreachable', fr: 'ENTSO-E est injoignable' },
    server: {
      en: `ENTSO-E is in trouble (${err?.status})`,
      fr: `ENTSO-E est en difficulté (${err?.status})`,
    },
    rate_limited: { en: 'ENTSO-E asked to slow down', fr: 'ENTSO-E a demandé de ralentir' },
    bad_request: { en: 'ENTSO-E refused the request', fr: 'ENTSO-E a refusé la requête' },
    too_large: { en: 'the answer is too large', fr: 'la réponse est trop grande' },
    invalid: { en: 'the answer cannot be read', fr: 'la réponse est illisible' },
    unsupported: {
      en: 'the zone is not priced in EUR/MWh',
      fr: "la zone n'est pas cotée en EUR/MWh",
    },
  };
  return (
    reasons[err?.code] ?? {
      en: `ENTSO-E answered ${err?.status ?? 'an error'}`,
      fr: `ENTSO-E a répondu ${err?.status ?? 'une erreur'}`,
    }
  );
}

/** Join a { en, fr } reason into a { en, fr } template taking a string. */
export function withReason(template, reason, ...args) {
  const en = template(reason.en, ...args).en;
  const fr = template(reason.fr, ...args).fr;
  return { en, fr };
}
