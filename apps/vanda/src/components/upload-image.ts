import { z } from "zod";
import type { Id } from "../convex/_generated/dataModel";

/** An image file in Convex storage, with what the image rows need to know about it. */
export type UploadedImage = {
  storageId: Id<"_storage">;
  mimeType: string;
  width?: number;
  height?: number;
};

/** The pixel size of an image file; empty when the browser can't decode it. */
export function imageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.addEventListener("load", () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    });

    img.addEventListener("error", () => {
      resolve({});
      URL.revokeObjectURL(url);
    });

    img.src = url;
  });
}

/** Upload one image file to storage through a fresh upload URL. */
export async function uploadImageFile(
  file: File,
  uploadUrl: () => Promise<string>,
): Promise<UploadedImage> {
  const dims = await imageDimensions(file);

  const res = await fetch(await uploadUrl(), {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
  });

  const payload = z.object({ storageId: z.string() }).parse(await res.json());

  // SAFETY: Convex's upload endpoint returns an encoded `_storage` document id.
  return { storageId: payload.storageId as Id<"_storage">, mimeType: file.type, ...dims };
}
