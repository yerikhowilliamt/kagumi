import { unstable_cache } from "next/cache";
import Image from "next/image";
import Button from "@/components/Button";
import ThemeToggle from "@/components/ThemeToggle";
import { db } from "@/lib/db";
import { toStoreProduct } from "@/lib/menu";
import { SHOP_WHATSAPP } from "@/lib/order";
import styles from "./page.module.css";

const WHATSAPP = `https://wa.me/${SHOP_WHATSAPP}`;
const INSTAGRAM = "https://www.instagram.com/kagumidough/";

// The page is static: products are read at build and revalidate time (System Design §4.2).
// Admin mutations revalidate the `products` tag; the hour is the fallback.
const getProducts = unstable_cache(
  async () => {
    const rows = await db.product.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        price: true,
        type: true,
        orderDeadline: true,
        media: {
          select: {
            publicId: true,
            kind: true,
            version: true,
            format: true,
            width: true,
            height: true,
            durationSec: true,
            isMain: true,
            sortOrder: true,
          },
        },
      },
    });
    // Mapped inside the cache: a cached result is JSON, so a Date would come back as a string.
    return rows.map(toStoreProduct);
  },
  ["store-products"],
  { tags: ["products"], revalidate: 3600 },
);

const FACTS = [
  ["PO & Ready Stock", "Pilih sesuai kebutuhan"],
  ["Antar / Ambil", "Fleksibel, kamu yang pilih"],
  ["Area Solo", "Surakarta & sekitarnya"],
];

const STEPS = [
  ["Pilih menu", "Tambahkan menu favoritmu ke keranjang. Bisa beberapa produk sekaligus."],
  ["Isi data & kirim", "Isi nama, tanggal, ambil atau antar, lalu kirim pesanan lewat WhatsApp."],
  ["Terima pesanan", "Kami siapkan fresh dan antar ke alamatmu di area Solo."],
];

export default async function Home() {
  const products = await getProducts();
  // design.md §6 Marquee: the list twice, translated by half.
  const marquee = [...products, ...products];

  return (
    <div className={styles.page}>
      <p className={styles.notice}>Pengantaran tersedia untuk area Solo &amp; sekitarnya</p>

      <header className={styles.nav}>
        <div className={`${styles.wrap} ${styles.navInner}`}>
          <a href="#" className={styles.brand} aria-label="Kagumi Dough">
            <Image className={styles.brandLogo} src="/images/logo.jpg" alt="" width={38} height={38} />
            <span className={styles.wordmark}>Kagumi Dough</span>
          </a>
          <nav className={styles.navLinks} aria-label="Navigasi utama">
            <a className={styles.navLink} href="#menu">
              Menu
            </a>
            <a className={styles.navLink} href="#cara-pesan">
              Cara Pesan
            </a>
            <a className={styles.navLink} href="#kontak">
              Kontak
            </a>
            <ThemeToggle />
            <Button variant="line" size="nav" href={WHATSAPP}>
              Pesan via WhatsApp
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={`${styles.wrap} ${styles.heroGrid}`}>
            <div>
              <p className={styles.label}>Homemade Bakery — Surakarta</p>
              <h1 className={styles.title}>
                Freshly baked, <span className={styles.highlight}>made to order.</span>
              </h1>
              <p className={styles.lead}>
                Bolu gulung, brownies, cookies, buko mangga hingga donut. Setiap pesanan dibuat fresh dari oven, dengan
                bahan pilihan dan sepenuh hati.
              </p>
              <div className={styles.actions}>
                <Button href="#menu" arrow>
                  Lihat Menu
                </Button>
                <Button variant="text" href={WHATSAPP} arrow>
                  Chat WhatsApp
                </Button>
              </div>
              <ul className={styles.facts}>
                {FACTS.map(([title, text]) => (
                  <li key={title} className={styles.fact}>
                    <strong className={styles.factTitle}>{title}</strong>
                    <span className={styles.factText}>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.visual}>
              <div className={styles.card}>
                <div className={styles.burst}>
                  <Image
                    className={styles.burstLogo}
                    src="/images/logo.jpg"
                    alt="Logo Kagumi Dough"
                    width={360}
                    height={360}
                    priority
                  />
                </div>
              </div>
              <div className={styles.sticker} aria-hidden="true">
                Made
                <br />
                with
                <br />
                love ♡
              </div>
            </div>
          </div>
        </section>

        {products.length > 0 && (
          <div className={styles.marquee} aria-hidden="true" data-testid="marquee">
            <div className={styles.track}>
              {marquee.map((product, i) => (
                <span key={i} className={styles.name}>
                  {product.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <section id="menu" className={`${styles.section} ${styles.anchor}`}>
          <div className={styles.wrap}>
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.label}>Menu</p>
                <h2 className={styles.sectionTitle}>Pilihan favorit kami</h2>
              </div>
            </div>
          </div>
        </section>

        <section id="cara-pesan" className={`${styles.section} ${styles.how} ${styles.anchor}`}>
          <div className={styles.wrap}>
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.label}>Cara Pesan</p>
                <h2 className={styles.sectionTitle}>Tiga langkah sederhana</h2>
              </div>
            </div>
            {/* role: list-style none drops the list semantics in Safari. */}
            <ol className={styles.steps} role="list">
              {STEPS.map(([title, text], i) => (
                <li key={title} className={styles.step}>
                  <span className={styles.num}>{`0${i + 1}`}</span>
                  <h3 className={styles.stepTitle}>{title}</h3>
                  <p className={styles.stepText}>{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.wrap}>
            <div className={styles.cta}>
              <div className={styles.ctaBody}>
                <p className={`${styles.label} ${styles.ctaLabel}`}>Pesanan khusus</p>
                <h2 className={styles.ctaTitle}>Ada acara spesial? Kami siap bantu.</h2>
                <p className={styles.ctaText}>
                  Brownies custom untuk ulang tahun, hampers untuk hari raya, atau pesanan dalam jumlah banyak.
                  Ceritakan kebutuhanmu.
                </p>
              </div>
              <div className={styles.ctaBody}>
                <Button variant="butter" href={WHATSAPP} arrow>
                  Chat WhatsApp
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer id="kontak" className={`${styles.footer} ${styles.anchor}`}>
        <div className={styles.wrap}>
          <div className={styles.footGrid}>
            <div>
              <a href="#" className={`${styles.brand} ${styles.footBrand}`} aria-label="Kagumi Dough">
                <Image className={styles.brandLogo} src="/images/logo.jpg" alt="" width={38} height={38} />
                <span>Kagumi Dough</span>
              </a>
              <p className={styles.tagline}>
                We&apos;re here to fulfil your sweet craving. Homemade bakery dari Surakarta.
              </p>
            </div>
            <div>
              <h2 className={`${styles.label} ${styles.footTitle}`}>Kontak</h2>
              <ul className={styles.footList}>
                <li>
                  <a className={styles.footLink} href={WHATSAPP}>
                    WhatsApp · 0851-5954-5168
                  </a>
                </li>
                <li>
                  <a className={styles.footLink} href={INSTAGRAM} target="_blank" rel="noopener">
                    Instagram · @kagumidough
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h2 className={`${styles.label} ${styles.footTitle}`}>Lokasi</h2>
              <ul className={styles.footList}>
                <li>Surakarta, Jawa Tengah</li>
                <li>Antar &amp; ambil sendiri</li>
              </ul>
            </div>
          </div>
          <div className={styles.copy}>
            <span>© 2026 Kagumi Dough</span>
            <span>Made to order, made with love.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
