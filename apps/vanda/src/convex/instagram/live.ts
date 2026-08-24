import * as Layer from "effect/Layer";
import { apifyPublicInstagramProviderLayer } from "./providers/apify";
import { uploadPostInstagramProviderLayer } from "./providers/uploadpost";
import { instagramServiceLayer } from "./service";

export const liveInstagramLayer = (apifyToken: string) =>
  instagramServiceLayer.pipe(
    Layer.provide(
      Layer.merge(uploadPostInstagramProviderLayer, apifyPublicInstagramProviderLayer(apifyToken)),
    ),
  );
