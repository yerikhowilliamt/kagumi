"use client";

import Image from "next/image";
import { cloudinaryLoader } from "@/lib/media";
import type { StoreMedia, Tone } from "@/lib/menu";
import styles from "./ProductThumb.module.css";

type Medium = Pick<StoreMedia, "kind" | "publicId" | "version">;

// The product card's size; callers in smaller slots may pass their own.
const CARD_SIZES = "(max-width: 640px) 100vw, (max-width: 960px) 50vw, 380px";

// Every product visual (M1-D9). It fills its parent, which sets the size and the radius.
// With an image among the media (in display order, the main one first): that image through Cloudinary (M3 plan D17).
// Otherwise the pastel fill and the logo burst mark. A Client Component, so a Server Component can render it: the loader
// is a function. Admin order lines pass `{ tone }` only and keep the placeholder.
export default function ProductThumb({
  product,
  sizes = CARD_SIZES,
  alt = "",
}: {
  product: { tone: Tone; media?: Medium[] };
  sizes?: string;
  /** Empty where the surrounding control already names the product (design.md §8). */
  alt?: string;
}) {
  const image = product.media?.find((m) => m.kind === "IMAGE");
  return (
    <span className={`${styles.thumb} ${styles[product.tone]}`}>
      {image ? (
        <Image className={styles.photo} loader={cloudinaryLoader} src={`v${image.version}/${image.publicId}`} alt={alt} fill sizes={sizes} />
      ) : (
        <Image className={styles.mark} src="/images/logo.jpg" alt="" aria-hidden="true" width={160} height={160} />
      )}
    </span>
  );
}
