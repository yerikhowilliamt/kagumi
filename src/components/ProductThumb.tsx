import Image from "next/image";
import type { StoreProduct } from "@/lib/menu";
import styles from "./ProductThumb.module.css";

// Every product visual (D9). It fills its parent, which sets the size and the radius.
// Without media: the pastel fill and the logo burst mark. M3 adds the Cloudinary branch here.
// It reads only the tone (M2 plan D24), so admin order lines pass `{ tone }` without a product.
export default function ProductThumb({ product }: { product: Pick<StoreProduct, "tone"> }) {
  return (
    <span className={`${styles.thumb} ${styles[product.tone]}`}>
      <Image className={styles.mark} src="/images/logo.jpg" alt="" aria-hidden="true" width={160} height={160} />
    </span>
  );
}
