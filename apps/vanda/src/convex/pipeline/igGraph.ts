import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { decodeUnknownEffect } from "effect/Schema";

/** A Graph API fetch or decode failure, tagged with the source that requested it. */
export class SourceFetchFailed extends Data.TaggedError("SourceFetchFailed")<{
  readonly source: string;
  readonly message: string;
}> {}

/**
 * Shared Instagram Graph read helper, used by every fetch that reads
 * `graph.instagram.com` (the observe source adapters and the onboarding brand
 * corpus). One place owns the base URL, the page size, and the
 * fetch -> decode -> typed-failure contract so the adapters only describe
 * *what* to request and *how* to map it.
 */

const GRAPH_BASE = "https://graph.instagram.com/v23.0";

export interface IgConfig {
  readonly igUserId: string;
  readonly token: string;
}

/** A raw, undecoded GET against the Graph API; rejects on a non-2xx response. */
export const graphGet = (config: IgConfig, path: string, fields: string): Promise<unknown> => {
  const query = new URLSearchParams({ fields, limit: "25", access_token: config.token });
  return fetch(`${GRAPH_BASE}${path}?${query.toString()}`).then(async (response) => {
    if (!response.ok) throw new Error(`graph ${path} -> HTTP ${response.status}`);
    return response.json();
  });
};

const graphGetUrl = (url: string): Promise<unknown> =>
  fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`graph page -> HTTP ${response.status}`);
    return response.json();
  });

/** Instagram timestamps are RFC-3339; fall back to now when absent/unparseable. */
export const parseTimestamp = (timestamp: string | undefined): number => {
  if (timestamp === undefined) return Date.now();
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

/**
 * GET + schema-decode in one step, mapping every failure (network, non-2xx,
 * decode mismatch) to a `SourceFetchFailed` tagged for `source`. Decoding (not
 * casting) keeps a shape change at Meta a typed, catchable failure rather than a
 * silent `undefined` downstream.
 */
export const fetchAndDecode = <A>(
  config: IgConfig,
  source: string,
  path: string,
  fields: string,
  schema: Schema.Codec<A, unknown>,
): Effect.Effect<A, SourceFetchFailed> =>
  Effect.tryPromise({
    try: () => graphGet(config, path, fields),
    catch: (error) =>
      new SourceFetchFailed({
        source,
        message: error instanceof Error ? error.message : String(error),
      }),
  }).pipe(
    Effect.flatMap((json) =>
      decodeUnknownEffect(schema)(json).pipe(
        Effect.mapError(
          (error) => new SourceFetchFailed({ source, message: `decode failed: ${error}` }),
        ),
      ),
    ),
  );

/** Decode a `paging.next` URL returned by Meta using the same typed failure contract. */
export const fetchUrlAndDecode = <A>(
  source: string,
  url: string,
  schema: Schema.Codec<A, unknown>,
): Effect.Effect<A, SourceFetchFailed> =>
  Effect.tryPromise({
    try: () => graphGetUrl(url),
    catch: (error) =>
      new SourceFetchFailed({
        source,
        message: error instanceof Error ? error.message : String(error),
      }),
  }).pipe(
    Effect.flatMap((json) =>
      decodeUnknownEffect(schema)(json).pipe(
        Effect.mapError(
          (error) => new SourceFetchFailed({ source, message: `decode failed: ${error}` }),
        ),
      ),
    ),
  );
