import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { BrandCorpusResult } from "./brand";
import { fetchAndDecode, type IgConfig, type SourceFetchFailed } from "./igGraph";

// --- Graph response schemas (decoded, not cast) ---------------------------

const IgProfile = Schema.Struct({
  username: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  account_type: Schema.optional(Schema.String),
  media_count: Schema.optional(Schema.Number),
  // Available on some account types only; absent decodes cleanly to undefined.
  biography: Schema.optional(Schema.String),
});

const IgCorpusMedia = Schema.Struct({
  data: Schema.optional(
    Schema.Array(
      Schema.Struct({
        caption: Schema.optional(Schema.String),
        comments: Schema.optional(
          Schema.Struct({
            data: Schema.optional(
              Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String) })),
            ),
          }),
        ),
      }),
    ),
  ),
});

const IgTags = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String }))),
});

/**
 * Assemble the cold-start brand corpus: the profile facts plus the text of recent
 * posts and the comments under them, and the presentation counts the Confirmar
 * screen shows ("LI N POSTS · N COMENTÁRIOS · N MENÇÕES"). Profile/media are
 * required (no content → can't analyze); the mentions count is best-effort —
 * the tags endpoint is often permission-gated, so a failure there defaults to 0
 * rather than aborting onboarding.
 */
export const fetchBrandCorpus = (
  config: IgConfig,
): Effect.Effect<BrandCorpusResult, SourceFetchFailed> =>
  Effect.all({
    profile: fetchAndDecode(
      config,
      "posts",
      "/me",
      "username,name,account_type,media_count,biography",
      IgProfile,
    ),
    media: fetchAndDecode(
      config,
      "posts",
      `/${config.igUserId}/media`,
      "caption,comments{text}",
      IgCorpusMedia,
    ),
    mentions: fetchAndDecode(config, "mentions", `/${config.igUserId}/tags`, "id", IgTags).pipe(
      Effect.map((tags) => (tags.data ?? []).length),
      Effect.orElseSucceed(() => 0),
    ),
  }).pipe(
    Effect.map(({ profile, media, mentions }): BrandCorpusResult => {
      const items = media.data ?? [];
      const comments = items.flatMap((m) =>
        (m.comments?.data ?? []).flatMap((c) => (c.text !== undefined ? [c.text] : [])),
      );
      const captions = items.flatMap((m) => (m.caption !== undefined ? [m.caption] : []));
      return {
        corpus: {
          profile: {
            name: profile.name,
            username: profile.username,
            biography: profile.biography,
            accountType: profile.account_type,
            mediaCount: profile.media_count,
          },
          captions,
          comments,
        },
        stats: { posts: items.length, comments: comments.length, mentions },
      };
    }),
  );
