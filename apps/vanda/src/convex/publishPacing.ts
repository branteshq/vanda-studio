/**
 * Instagram flags bursts of feed posts as spam and restricts the account for
 * 24–48h (Upload-Post: docs.upload-post.com/resources/common-errors). Every
 * feed publication is paced here, whoever asks for it, so an owner's "posta
 * tudo agora" cannot become a burst.
 */

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

/** Minimum time between two feed publications of one account. */
export const MIN_PUBLISH_GAP_MS = 2 * HOUR;

/** Feed publications per account per calendar day in São Paulo. */
export const MAX_FEED_POSTS_PER_DAY = 4;

/** America/Sao_Paulo has been fixed at UTC−3 since DST ended in 2019. */
const SAO_PAULO_OFFSET_MS = -3 * HOUR;

const localDay = (timestamp: number): number => Math.floor((timestamp + SAO_PAULO_OFFSET_MS) / DAY);

const nextLocalMidnight = (timestamp: number): number =>
  (localDay(timestamp) + 1) * DAY - SAO_PAULO_OFFSET_MS;

/**
 * The earliest time at or after `requested` that keeps the gap to every
 * `taken` publication and stays under the daily cap.
 */
export const nextPublishSlot = (requested: number, taken: readonly number[]): number => {
  let at = requested;

  for (;;) {
    const near = taken.filter((other) => Math.abs(other - at) < MIN_PUBLISH_GAP_MS);

    if (near.length > 0) {
      at = Math.max(...near) + MIN_PUBLISH_GAP_MS;
      continue;
    }

    const sameDay = taken.filter((other) => localDay(other) === localDay(at)).length;

    if (sameDay >= MAX_FEED_POSTS_PER_DAY) {
      at = nextLocalMidnight(at);
      continue;
    }

    return at;
  }
};

const SPAM_RESTRICTION =
  /suspected as spam|activity is restricted|temporarily restricted|account_restricted|spam_restricted/i;

const PUBLISH_LIMIT = /publishing limit|publish_limit|daily_upload_limit|rate_limited/i;

const UNTIL_UTC = /until (\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})? ?UTC/i;

/**
 * When a publish failure means Instagram (or Upload-Post on its behalf) is
 * refusing this account's feed posts, the time to stop trying until.
 * Retrying inside a spam restriction extends it.
 */
export const publishRestrictionUntil = (lastError: string, now: number): number | null => {
  const spam = SPAM_RESTRICTION.test(lastError);

  if (!spam && !PUBLISH_LIMIT.test(lastError)) return null;

  const until = UNTIL_UTC.exec(lastError);
  const stated = until ? Date.parse(`${until[1]}T${until[2]}:00Z`) : Number.NaN;

  if (Number.isFinite(stated) && stated > now) return stated;

  // Upload-Post's own pauses: 24h after a spam block, 30 minutes after a quota hit.
  return now + (spam ? DAY : 30 * MINUTE);
};

/** "17/10 às 15:20" in Brasília time, for messages the owner reads. */
export const brasiliaTime = (timestamp: number): string => {
  const local = new Date(timestamp + SAO_PAULO_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)} às ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
};

export const restrictionMessage = (until: number): string =>
  `O Instagram restringiu as publicações desta conta (posts demais em pouco tempo) até ${brasiliaTime(until)} (horário de Brasília). Não tente publicar antes disso: cada tentativa pode estender o bloqueio. Agende para depois desse horário, poucos posts por dia.`;
