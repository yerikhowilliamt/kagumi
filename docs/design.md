# Design System: Kagumi Dough

**Status:** Accepted (2026-11-15)
**Platform:** Next.js (App Router) on Vercel, responsive web, light and dark themes.
**Scope:** public storefront (home, product detail, cart, checkout) and admin dashboard (login, overview, orders, products, statistics).

## 1. Design Direction

Kagumi Dough is a small homemade bakery in Solo that sells by pre-order and ready stock. The site should feel **clean and premium** (so a home bakery reads as trustworthy and worth its price) while keeping the **playful retro-sticker energy of the logo** (blue scalloped badge, cream lettering, doodles). The base is quiet: warm ivory (or deep navy in dark mode), generous whitespace, thin hairline rules, and one strong brand blue. The fun comes from a small set of controlled accents: the **starburst shape** taken from the logo, **pastel fills** behind products, a **highlighter** under one key phrase, and a slow product-name **marquee**. Accents decorate. They never carry text that must be read at small size, and they never replace blue as the action color.

The **admin dashboard** uses the same tokens but is calmer and denser, like a control panel. It adds a few data-display patterns: uppercase micro-labels, numbers with units, segmented meters, a line chart, an activity feed with colored rails, and a live status dot. It's built for the owner's phone first.

Rule of thumb: if a storefront section already has one accent (a burst, a pastel block, or the marquee), don't add a second.

## 2. Color Tokens

All colors are CSS custom properties defined once on `:root` in the global stylesheet and redefined for dark mode (see 2.6). Components reference tokens only, never hex values. The only exceptions are listed in 2.7.

### 2.1 Brand & accents

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--blue` | `#0b4ead` | `#1f5bcc` | Brand fill: primary buttons, hero card, CTA band, notice bar, label marker, cart badge |
| `--blue-ink` | `#08367a` | `#2f6be0` | Hover/active of `--blue` fills |
| `--link` | `#0b4ead` | `#8fb4ff` | Blue **text**: links, hero keyword, order links, chart line, focus ring |
| `--butter` | `#ffe7a3` | `#f5dc8f` | Accent fill: hero burst, CTA burst and button, step 01, PO tag (dark), status "Dikonfirmasi", nav count |
| `--pink` | `#ffd0c8` | `#f2c0b8` | Accent fill: sticker, step 02, placeholder, status "Dibatalkan" |
| `--mint` | `#cdeedc` | `#bfe3cf` | Accent fill: step 03, placeholder, success burst, status "Selesai" |
| `--sky` | `#d6e4ff` | `#c6d6f5` | Accent fill: placeholder, status "Baru" |
| `--amber` | `#e8a33a` | `#e8a33a` | Data accent: marquee separator, funnel "add to cart", previous-period chart line, PO activity rail |
| `--coral` | `#e57a6c` | `#e57a6c` | Marquee separator only |
| `--on-accent` | `#0e1a33` | `#0e1a33` | Text on any pastel/butter fill. Never changes with the theme |

Pastels are **fills only**. Text on them is always `--on-accent`. Product placeholder fills rotate butter → pink → sky → mint.

### 2.2 Neutrals (warm, to sit with the cream in the logo)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--bg` | `#faf8f3` | `#0b1220` | Page background |
| `--surface` | `#ffffff` | `#121b2e` | Raised surfaces: panels, sheets, dialogs, inputs, marquee and steps bands |
| `--surface-2` | `#f4f1ea` | `#18233a` | Admin: hover rows, segmented-control track, note boxes |
| `--line` | `rgb(14 26 51 / .09)` | `rgb(243 239 228 / .1)` | Hairlines, dividers, quiet borders |
| `--field` | `rgb(14 26 51 / .16)` | `rgb(243 239 228 / .18)` | Input borders |
| `--seg-off` | `rgb(14 26 51 / .08)` | `rgb(243 239 228 / .1)` | Inactive meter segments, switch track off |
| `--muted` | `#6b6a66` | `#a3a8b5` | Secondary text |
| `--ink` | `#0e1a33` | `#f3efe4` | Primary text, headings, step top rule |
| `--strong` | `#0e1a33` | `#f3efe4` | Inverted fill: selected chip/segment, active nav item, toast |
| `--on-strong` | `#ffffff` | `#0b1220` | Text on `--strong` |
| `--nav-bg` | `rgb(250 248 243 / .86)` | `rgb(11 18 32 / .82)` | Sticky nav / topbar (with blur) |
| `--hl-bg` | `#ffe7a3` | `rgb(31 91 204 / .6)` | Highlighter bar under the hero keyword (butter is muddy on navy, so dark uses blue) |

### 2.3 Tags

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--tag-bg` | `rgb(255 255 255 / .94)` | `rgb(18 27 46 / .9)` | Ready-stock tag on thumbnails |
| `--tag-po-bg` | `#0e1a33` | `#f5dc8f` | Pre-order tag on storefront thumbnails |
| `--tag-po-fg` | `#ffe7a3` | `#0e1a33` | Pre-order tag text |

### 2.4 Semantic

| Token | Light | Dark | Usage | Contrast |
|---|---|---|---|---|
| `--success` | `#1b7a52` | `#5fd39a` | Ready-stock text, positive deltas, "Selesai", switch on | 5.31:1 on `#fff` · 9.22:1 on dark surface |
| `--success-bg` | `#e6f4ec` | `rgb(95 211 154 / .14)` | Ready tag (admin), "ready" status tile | `--success` on it: 4.68:1 |
| `--warning` | `#b4532a` | `#f0a070` | Order deadline, closed-PO note | 4.70:1 on `--bg` · 8.89:1 on dark bg. Keep ≥ 13px / 500 |
| `--error` | `#b42318` | `#ff8a7a` | Field errors, negative deltas, destructive button, "Ditutup" tile | 6.57:1 on `#fff` · 7.5:1 on dark surface |
| `--error-bg` | `#fdf0ee` | `rgb(255 138 122 / .12)` | Error alert, destructive hover, closed tile | `--error` on it: 5.91:1 |
| `--info-bg` | `#f2f6fd` | `rgb(143 180 255 / .08)` | Upload drop zone | — |
| `--live` | `#22a06b` | `#5fd39a` | Status dots (open shop, open PO) | Decorative, always paired with text |

### 2.5 Key pairings (verified)

| Foreground | Background | Light | Dark |
|---|---|---|---|
| `--ink` | `--bg` | 16.3:1 | 16.3:1 |
| `--muted` | `--bg` | 5.1:1 | 7.87:1 |
| `--muted` | `--surface` | 5.41:1 | 7.22:1 |
| `--link` | `--bg` | 7.31:1 | 9.04:1 |
| `#fff` | `--blue` | 7.76:1 | 6.13:1 |
| `--on-accent` | `--butter` | 14.17:1 | 12.78:1 |
| `--on-accent` | `--pink` | 12.44:1 | 10.71:1 |
| `--on-accent` | `--sky` | 13.51:1 | 11.81:1 |
| `--on-accent` | `--mint` | 13.88:1 | 12.44:1 |
| `#0b2e1a` | WhatsApp `#25d366` | 7.46:1 | 7.46:1 |

Text on `--blue` may use `rgb(255 255 255 / .75–.85)` for secondary copy. Don't go below .75.

### 2.6 Theming (light / dark)

- **Default:** follow the OS (`prefers-color-scheme`).
- **Manual override:** a theme toggle (sun/moon icon) sets `data-theme="light|dark"` on `<html>` and stores it in `localStorage` under `kagumi-theme`. One preference covers the storefront and the admin.
- **No flash:** a tiny inline script in `<head>` applies the stored theme before first paint. Wrap storage access in `try/catch`.
- **CSS structure:** light values on `:root`. Dark values in `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and again in `:root[data-theme="dark"] {…}`. Set `color-scheme` to match so native controls (date picker, scrollbars) follow.
- Pastel fills stay light in dark mode (slightly muted values above) and keep `--on-accent` text. They're the playful accent, and keeping them bright is intentional.

### 2.7 Fixed colors (theme-independent, allowed as literals)

| Value | Use |
|---|---|
| `#25d366` bg / `#0b2e1a` text | WhatsApp buttons only |
| `#dcf8c6` bg / `#111b21` text | WhatsApp message preview bubble on the order-confirmation screen |
| `#0e1a33` bg / `#ffe7a3` text | "Utama" badge on admin media thumbnails (sits on photos) |
| `rgb(14 26 51 / .7)` / white | Video duration chip and play button on media (sits on photos) |

## 3. Typography

- **Headings & UI:** `Switzer` (Fontshare), fallback `system-ui, sans-serif`. Token `--head`.
- **Body:** `Figtree` (Google Fonts), weights 400/500/600, fallback `system-ui, sans-serif`. Token `--body`. `-webkit-font-smoothing: antialiased`.
- **Numbers:** `font-variant-numeric: tabular-nums` for prices, quantities, KPIs, tables and timestamps.

### Type scale

| Role | Font | Size | Weight | Line-height | Letter-spacing |
|---|---|---|---|---|---|
| Display (hero h1) | head | `clamp(44px, 6.4vw, 84px)` | 600 | 1.02 | -0.035em |
| Section title (h2) | head | `clamp(34px, 4.4vw, 54px)` | 600 | 1.02 | -0.035em |
| CTA title | head | `clamp(32px, 4vw, 50px)` | 600 | 1.02 | -0.035em |
| Product detail title | head | `clamp(30px, 3.4vw, 40px)` | 600 | 1.1 | -0.03em |
| Admin page title | head | `clamp(26px, 3vw, 34px)` | 600 | 1.1 | -0.03em |
| Trend number (admin) | head | 48px | 600 | 1 | -0.04em |
| KPI number (admin) | head | 34px (28px mobile) | 600 | 1 | -0.03em |
| Step title / sheet title | head | 24px / 22px | 600 | 1.1 | -0.03em |
| Product name | head | 21px | 600 | 1.1 | -0.02em |
| Marquee | head | 22px | 500 | 1 | -0.02em |
| Lead | body | 18px | 400 | 1.65 | 0 |
| Body | body | 16px (storefront) / 15px (admin) | 400 | 1.6 | 0 |
| Description, table cell | body | 14–15px | 400 | 1.55 | 0 |
| UI text (buttons, chips, prices, links) | head | 13–15px | 500 | 1 | -0.01em |
| Small (helper, captions, timestamps) | body | 12–13px | 400–500 | 1.5 | 0 |
| Eyebrow label (with burst marker) | head | 11–12px | 500 | 1 | 0.16em, uppercase |
| Micro-label (admin panel titles, table headers, chart axis, units) | head | 11px | 500 | 1 | 0.08–0.12em, uppercase |

### Usage notes

- One h1 per page. Every storefront section opens with an **eyebrow label** (burst marker + uppercase) followed by an h2.
- The hero keyword is `--link` with the **highlighter**: a bar `0.2em` tall in `--hl-bg` behind the bottom of the text. Once per page.
- In the admin, panel titles are **micro-labels**, not headings, so the numbers carry the hierarchy. Numbers show their unit in a smaller muted span ("412 orang", "5,6 %").
- Buttons, chips, tags and prices use the heading font so UI reads as one family with the titles.
- Copy language: Indonesian. Short English brand taglines are allowed ("Freshly baked, made to order", "We're here to fulfil your sweet craving").

## 4. Spacing & Layout

### Spacing scale (4px base)

`2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 24 · 28 · 32 · 40 · 44 · 48 · 56 · 64 · 72 · 80 · 104 · 120`

| Use | Value |
|---|---|
| Inline gaps (icon ↔ text, chips) | 6–10 |
| Product grid gap | 40 row / 28 column |
| Admin grid gap (panels) | 12 |
| Panel padding (admin) | 20 |
| Sheet padding | 24 horizontal, 20 header |
| Form field spacing | 18 between fields, 6 label ↔ input |
| Section head → content | 44 (storefront), 24 (admin) |
| Section vertical padding | `clamp(72px, 9vw, 120px)` |
| Hero padding | `clamp(56px, 8vw, 104px)` top, `clamp(56px, 7vw, 88px)` bottom |

### Layout

| Token | Value |
|---|---|
| `--wrap` | 1180px max content width (storefront) |
| `--gutter` | `clamp(20px, 4vw, 40px)` |
| Storefront nav | sticky, 72px. scroll-padding-top 84px |
| Admin sidebar | 248px, sticky full-height |
| Admin main padding | `28px clamp(16px, 3vw, 40px) 96px` |
| Admin mobile topbar / bottom nav | 60px / ~64px + safe-area |
| Cart sheet | right side, `min(460px, 100%)` |
| Product detail dialog | `min(960px, 100% − 32px)`, 2 columns (1.05fr / 1fr) |

### Border radius

| Token | Value | Use |
|---|---|---|
| `r-xs` | 6px | Admin pills (activity labels), media chips |
| `r-sm` | 10px | Small thumbs (44px), admin icon buttons, status tiles, media tiles |
| `r-md` | 12–16px | Inputs (12), cart line thumbs (14), floating card (16), drop zone (16), mobile cards (16) |
| `--radius` (r-lg) | 20–22px | Product thumbnails (22), admin panels (20), gallery main image (20) |
| `r-xl` | 28–32px | Hero card, CTA band (32), product detail dialog (28), mobile bottom sheet top corners (24) |
| `r-full` | 999px | Buttons, chips, tags, status badges, quantity stepper, toast, cart bar |

### Shadow / elevation

Flat by default. Depth comes from color blocks and hairlines.

| Level | Value | Use |
|---|---|---|
| none | — | Everything else |
| float | `0 20px 40px -20px rgb(14 26 51 / .35)` | Floating promo card |
| toast | `0 16px 32px -12px rgb(0 0 0 / .35)` | Toast |
| cta-glow | `0 16px 32px -12px rgb(11 78 173 / .6)` | Mobile cart bar, admin mobile "Tambah produk" FAB |
| backdrop | `rgb(11 18 32 / .5)` + `blur(4px)` | Dialog / sheet backdrop |

### Breakpoints

| Breakpoint | Storefront | Admin |
|---|---|---|
| > 1180px | — | KPIs 4 columns, overview 1.6fr/1fr and 3-column rows |
| ≤ 1180px | — | KPIs 2 columns, all two-column layouts stack |
| ≤ 960px | Hero stacks, product grid 2 columns, CTA 1 column | — |
| ≤ 760px | Product detail becomes a bottom sheet (92vh), cart sheet full width | Sidebar → topbar + bottom nav, tables → cards, sparklines hidden, FAB for "Tambah produk" |
| ≤ 640px | Nav: logo + theme + WhatsApp + cart. Grid 1 column. Sticky cart bar appears when the cart has items | — |

### Shape: starburst

The signature shape from the logo badge: a 32-point polygon (16 peaks, inner radius 84%), defined once as `--burst` and applied with `clip-path: var(--burst)`:

```
polygon(50% 0%, 58.2% 8.8%, 69.1% 3.8%, 73.3% 15.1%, 85.4% 14.6%, 84.9% 26.7%, 96.2% 30.9%, 91.2% 41.8%, 100% 50%, 91.2% 58.2%, 96.2% 69.1%, 84.9% 73.3%, 85.4% 85.4%, 73.3% 84.9%, 69.1% 96.2%, 58.2% 91.2%, 50% 100%, 41.8% 91.2%, 30.9% 96.2%, 26.7% 84.9%, 14.6% 85.4%, 15.1% 73.3%, 3.8% 69.1%, 8.8% 58.2%, 0% 50%, 8.8% 41.8%, 3.8% 30.9%, 15.1% 26.7%, 14.6% 14.6%, 26.7% 15.1%, 30.9% 3.8%, 41.8% 8.8%)
```

Allowed uses only:
- Storefront: label marker (10px), marquee separator (16px), step number (52px), sticker (112px), product placeholder mark (40% of thumb), hero burst (78% of hero card), CTA corner burst (320px), empty-cart icon (64px), order-success icon (76px).
- Admin: label marker (9px), KPI corner accent (70px), upload drop-zone icon (44px), login background bursts (520px / 300px).

### Motion

| Name | Value | Use |
|---|---|---|
| fast | `.2s` ease | Hover, chip/segment state, arrow nudge (3px), switch |
| press | `scale: .97`, `.1s` ease-out | Every button, on pointer-down |
| slow | `.6s cubic-bezier(.2, .7, .2, 1)` | Product photo zoom (1.04), placeholder mark rotate (20deg) |
| sheet | `.35s cubic-bezier(.2, .7, .2, 1)` | Cart sheet slide, mobile detail rise. Closing runs the same path in reverse |
| pop | `.3s` same curve | Product detail dialog (fade + scale from .97), reversed on close. Backdrop fades with it |
| toast | `.25s` | Toast slide-up/fade, auto-hide after 2.6s (paused while hovered or focused) |
| spin | 30s linear (hero burst, logo counter-rotates), 40s (CTA burst) | Ambient |
| marquee | 32s linear | Product-name strip |
| pulse | 2s ease-in-out | Admin live dot ring |

Dialogs open and close with CSS transitions (`@starting-style` + `allow-discrete`), not keyframes, so closing mid-open reverses from the current position.

`prefers-reduced-motion: reduce` disables every animation and transition and smooth scrolling.

## 5. Component Patterns — Shared

### Buttons

`r-full`, heading font 500. Optional trailing `→` that nudges 3px right on hover.

| Variant | Default | Hover | Use |
|---|---|---|---|
| Primary | `--blue` bg, `#fff` | `--blue-ink`. Storefront lifts −2px (hover-capable pointers only) | Main action |
| Line | `--surface` bg, 1px `--line`, `--ink` | border `--ink` | Secondary action, nav WhatsApp |
| Butter | `--butter` bg, `--on-accent` | lift | Action on `--blue` (CTA band) |
| WhatsApp | `#25d366` bg, `#0b2e1a` | `#1fbd5a` | Anything that opens WhatsApp: checkout submit, "Buka chat WhatsApp" |
| Danger | `--surface` bg, `--error` text, border `--error` at 35% | `--error-bg` | "Hapus produk" |
| Text link | 1px bottom border in currentColor | arrow nudge | Inline secondary action |
| Icon (round / square) | 36–42px, `--surface`, 1px `--line`, `--ink` or `--muted` icon | border `--ink` | Theme toggle, cart, close (✕), edit |

Sizes: storefront 50px (nav 42px), admin 42px, sheet/detail 46px, small 34px. Full-width variant in sheets.

- **Focus:** `outline: 2px solid --link; outline-offset: 3–4px`.
- **Pressed:** `scale: .97` on pointer-down, on every button.
- **Hit area:** controls under 44px (steppers, close, icon buttons, text buttons, media remove) keep their size and extend the hit area to about 44px with a pseudo-element.
- **Disabled:** opacity .45, `not-allowed`. Avoid where possible. A closed product shows a dashed, muted add button instead.

### Theme toggle

Icon button showing a sun in light mode and a moon in dark mode. `aria-label="Ganti tema terang/gelap"`. Placement: storefront nav (before the WhatsApp button), admin sidebar bottom ("Ganti tema"), admin mobile topbar, login corner.

### Inputs

Height 46px storefront / 44px admin, padding 0 14px, `r-md` 12px, `--surface` bg, 1px `--field` border. Label above (head 13px/500). Helper text below (12px `--muted`).

| State | Style |
|---|---|
| Default | border `--field` |
| Hover | border `--muted` |
| Focus | border `--link` + `0 0 0 3px` ring of `--link` at 22% |
| Error | border `--error` + ring of `--error` at 15%, `aria-invalid="true"`, message below in 12px/500 `--error`, focus moves to the first invalid field |
| Disabled | not used |

Textarea: min-height 88–104px, vertical resize. Prefix (e.g. "Rp"): muted text inside the left padding. Date inputs follow `color-scheme`.

### Segmented control

Track `--bg`/`--surface-2` with 1px `--line`, 4px padding. Options are equal-width (storefront, 44px high, with an optional small second line) or auto-width pills (admin, 32px high). Selected: storefront `--surface` + subtle shadow; admin `--strong`/`--on-strong`. Uses `aria-pressed`.

### Switch

40×24 track (`--seg-off` off, `--success` on), 18px white knob, `role="switch"` with `aria-checked`. Label beside or via `aria-label`.

### Quantity stepper

Pill with 1px `--line`, − / count / + buttons. 34px high (cart line) or 46px (product detail). Count uses tabular nums. Minimum 1 in detail. Reaching 0 in the cart removes the line.

### Tags & status

| Element | Style |
|---|---|
| Pre-order tag (storefront thumb) | `--tag-po-bg` / `--tag-po-fg` |
| Ready tag (storefront thumb) | `--tag-bg` / `--success` |
| Pre-order tag (admin, detail) | `--butter` / `--on-accent` |
| Ready tag (admin, detail) | `--success-bg` / `--success` |
| Hidden tag (admin) | `--surface-2` / `--muted` |
| Order status badge | pill 26px, 6px dot in currentColor. Baru `--sky`, Dikonfirmasi `--butter`, Selesai `--mint`, Dibatalkan `--pink`, all with `--on-accent` text |

## 6. Component Patterns — Storefront

### Navigation

Sticky 72px, `--nav-bg` + `backdrop-filter: saturate(1.4) blur(14px)`, bottom hairline. Left: 38px round logo + wordmark. Right: text links (`--muted`, hover `--ink`), theme toggle, Line "Pesan via WhatsApp" button, then the **cart button** (round icon, bag glyph) with a count badge (20px `--blue` pill, white 11px/600, hidden at 0).

### Notice bar

Full width, `--blue` bg, 13px `rgb(255 255 255 / .85)`, key phrase bold in `--butter`. Content: an "Open pre-order" phrase (the bold part), shown only while at least one pre-order is open, followed by the delivery-area text. With no open pre-order, the delivery-area text stands alone.

### Hero

Two columns. Left: eyebrow, h1 with highlighter, lead, Primary + Text link, 3 facts separated by hairlines. Right: `--blue` hero card (`r-xl`, 4/5) with a rotating butter burst holding the logo, the pink **sticker** overlapping the top-right corner (112px, rotated 12deg, `--on-accent` text, `aria-hidden`), and the **floating promo card** overlapping the bottom-left (`--surface`, `r-md`, float shadow, 52px thumb + title + `--live` dot status). The promo card shows the open pre-order with the nearest order deadline, opens that product's detail when tapped, and is hidden when no pre-order is open.

### Marquee

`--surface` band between hairlines. Product names (marquee style) separated by 16px bursts cycling `--blue` / `--amber` / `--coral`. The list is duplicated and translated −50%. `aria-hidden`.

### Filter chips

Track `--surface`, 1px `--line`, 4px padding. Chips 38px, `--muted`. Selected: `--strong` / `--on-strong`. Semua / Ready stock / Pre-order.

### Product card

Not boxed: the thumbnail carries the color, and the text sits on the page background.

- **Thumbnail** (4/5, `--radius`, a `<button>` labelled "Lihat detail {name}" → opens product detail): photo with hover zoom, or placeholder (pastel fill + logo burst mark, hover rotate). Tag top-left.
- **Meta:** name (clickable → detail) left, price right. No price → "Harga via WA" in `--muted`.
- **Description** 15px `--muted`. **Deadline** (optional) 13px/500 `--warning`.
- **Add button:** Line-style pill 40px, "+ Tambah ke keranjang". When the product is in the cart it switches to `--strong` / `--on-strong`, "✓ Di keranjang (n)", and clicking adds one more.
- **Closed** (deadline passed): thumbnail at 50% opacity, add button dashed and muted with "Order sudah ditutup", not clickable. Closed cards sort last.

### Product detail (dialog)

Native `<dialog>` with `showModal()`, backdrop as in 4. Desktop: 2 columns.
- **Gallery:** main media (4/5, `r-lg`) + 4-column thumbnail row (`r-sm`, selected = 2px `--ink` border, video thumbs show a ▶ overlay). Videos play inline in the main slot.
- **Info:** close button top-right, tag, title, price (`--muted` "Harga dikonfirmasi via WhatsApp" when empty), description, deadline, a short fact list (pickup/delivery, made fresh) above a hairline, then a bottom row with the quantity stepper (46px) and Primary "Tambah ke keranjang".
- **Mobile (≤ 760px):** bottom sheet, 92vh max, top corners 24px, buy row sticky at the bottom, close button sticky at the top right.
- **Short desktop viewports:** the dialog is capped at the viewport height minus 32px and scrolls.
- Closes on ✕, Esc, or backdrop click.

### Cart sheet

Right-side `<dialog>` (full width on mobile) with three steps sharing one header (title + mini step indicator "1 Keranjang → 2 Data pemesan", current step in `--ink`/600).

1. **Keranjang:** lines = 64px thumb (`r-md`) · name + unit price + type · "Hapus" text button · line total + 34px stepper. Footer: subtotal (head 20px/600, priced lines only), note ("+ n produk tanpa harga, dikonfirmasi lewat WhatsApp" or the delivery-fee note), full-width Primary "Lanjut isi data →".
   - **Empty:** 64px butter burst, "Keranjang masih kosong", hint, Line "Lihat menu".
   - **Line no longer orderable** (the server rejected the checkout): an error alert at the top of the sheet (`--error-bg` / `--error`, "Ada produk yang sudah tidak bisa dipesan. Hapus dulu untuk melanjutkan."). The affected line shows its thumb at 50% opacity and, in place of the stepper, the reason in 12px/500 `--error` ("Order sudah ditutup" or "Produk tidak tersedia"). "Lanjut isi data" is disabled until those lines are removed.
2. **Data pemesan:** fields in order: Nama · Nomor WhatsApp (`inputmode="tel"`, helper "Supaya kami bisa menghubungi kamu soal pesanan ini") · Pengambilan (segmented: "Ambil sendiri / di Surakarta" vs "Diantar / area Solo, ongkir via chat") · Alamat (shown only for Diantar) · Tanggal diminta (min = today, helper about PO deadlines) · Catatan (optional). Then an order summary box (`--bg`, `r-md`). Footer: full-width **WhatsApp** button "Kirim pesanan via WhatsApp", a privacy line (12px `--muted`), "← Kembali ke keranjang".
   - **Too many attempts** (checkout rate limit): an error alert above the fields, "Terlalu banyak percobaan. Coba lagi beberapa menit lagi, atau chat kami langsung di WhatsApp.", where the last words are a Text link to the shop's WhatsApp.
3. **Selesai:** 76px mint burst with ✓, "Pesanan tersimpan!", the order number in bold, and a WhatsApp-style bubble preview of the exact message. Footer: WhatsApp "Buka WhatsApp lagi" + "Kembali ke menu". The cart is cleared.
   - **Order not saved** (the server failed, the message is still sent): the same layout with a butter burst holding "!" in place of the mint ✓, the title "Pesanan belum tercatat di sistem kami", the text "Pesananmu tetap bisa dikirim. Tekan tombol di bawah untuk mengirimnya lewat WhatsApp.", no order number, the message bubble, and the WhatsApp button "Kirim via WhatsApp". The cart is kept.

### Toast

Bottom-center pill, `--strong` / `--on-strong`, message + butter "Lihat keranjang" button. Shows on add-to-cart and auto-hides after 2.6s; the timer pauses while the toast is hovered or focused. `role="status"`. Hidden whenever a dialog opens.

### Mobile cart bar (≤ 640px)

Fixed 12px from the bottom and sides, 56px, `--blue`, cta-glow shadow: "Lihat keranjang · n item" + subtotal chip (white at 18%). Only visible when the cart has items. Opens the cart sheet.

### Steps

3 columns, 1px `--ink` top rule, 52px burst number (butter → pink → mint, `--on-accent`), title, `--muted` description. On a `--surface` band between hairlines.

### CTA band

`--blue`, `#fff`, `r-xl`, rotating butter corner burst, label marker in butter, Butter button.

### Footer

3 columns (1.5fr 1fr 1fr): brand + tagline, Kontak, Lokasi. Headings use the eyebrow style. Bottom row 13px `--muted` above a hairline.

## 7. Component Patterns — Admin

### Shell

- **Desktop:** 248px `--surface` sidebar with a right hairline. Brand (34px logo + "Kagumi Dough / Admin"), nav items (42px, `r-md`, icon 18px + label; hover `--surface-2`; current = `--strong`/`--on-strong`; "Pesanan" shows a butter count pill for new orders). Bottom group: theme toggle, "Lihat website", "Keluar".
- **Mobile (≤ 760px):** 60px topbar (`--nav-bg`, blur) with logo, theme toggle and logout. Fixed bottom nav with 4 items (icon 22px + 11px label). The current item is `--link` with a 3px top indicator.

### Status bar

Top of every admin page, above the title, separated by a hairline: live dot (8px `--live` with a pulsing ring) + "n pesanan baru · n PO aktif · Diperbarui hh.mm", and the period segmented control (7 hari / 30 hari) on the right (hidden on mobile).

### Panel

`--surface`, 1px `--line`, radius 20px, padding 20px. Header row: micro-label title (`--ink`) left, and on the right either a micro-label meta (`--muted`, e.g. "7 HARI") or a small `--link` action ("Detail →").

### KPI tile

Panel with micro-label, number (34px/600, tabular) + unit span (13px `--muted`), delta line (12px/500, `--success` ▲ or `--error` ▼), a 70px pastel burst peeking from the top-right corner (accent per tile: sky, butter, mint, pink), and a 72×26 sparkline (`--link`, 1.6px) bottom-right (hidden on mobile).

### Line chart (trend)

Left column (170px): big number (48px), delta + average, then a hairline and 3 stat rows (label `--muted`, value head 14px/600). Right: SVG line chart, 210px high, 3 horizontal gridlines (`--line`), current period = 2.2px `--link` line over a gradient area fill (brand blue, 28% → 0), previous period = 2px dashed `--amber`. Strokes use `vector-effect: non-scaling-stroke`. X-axis labels are micro-labels. The legend uses short 14×2px line swatches. The SVG gets `role="img"` with an `aria-label` summarizing the data.

### Segmented meter

Label row (name left, value right with optional muted unit/percentage), then 24 segments (3px gap, 14px high, radius 2px). Filled segments use `--c` (default `--link`, or `--sky` / `--amber` / `--success` for funnel stages). Empty segments use `--seg-off`. Optional 12px `--muted` footnote. **Mini variant** for table cells: 12 segments of 6×12px, 2px gap. The upload progress bar uses the same 10-segment pattern.

### Activity feed

Rows: time (head 12px `--muted`, tabular) · title (head 13px/600) + detail (12px `--muted`) · pill label (22px, `r-xs`, 1px currentColor border, 10px/600 uppercase). A 3px colored rail on the left edge carries the type: new order `--link`, PO deadline `--amber`, completed `--success`, confirmed or cancelled `--line`. Rows are separated by hairlines. The overview feed has three sources only: new orders, order status changes, and open pre-orders with a deadline (days left). Also used for the order history in order detail.

### Menu status tiles

4-column grid of 44px tiles (`r-sm`), each with a 2-letter product code (head 11px/600 uppercase, full name in `title`): PO open = `--butter`/`--on-accent`, ready = `--success-bg`/`--success`, closed = `--error-bg`/`--error` with a 40% error border, hidden = `--surface-2`/`--muted`. Legend below.

### Tables

Header cells are micro-labels with a bottom hairline. Body cells have 14px padding and hairline separators. Clickable rows highlight in `--surface-2`; rows and mobile cards are focusable and open on Enter. Numeric columns right-aligned and tabular. The product cell is a 44px thumb (`r-sm`) + name (head 14px/600) + meta (12px `--muted`). Below 760px, tables are replaced by **mobile cards** (`--surface`, 1px `--line`, radius 16px, 56px thumb, name + meta line + status badge).

### Toolbar

Filter chips with counts (selected `--strong`/`--on-strong`, count at 70% opacity) on the left, and, on the orders list only, a 38px pill search field with an icon on the right (full width on mobile) that searches by customer name or order number. The products list has the chips alone.

### Product form

Two panels (1.2fr / 1fr):
- **Informasi produk:** Nama · Kategori (text input that suggests the existing categories, so a new one can be typed) + Harga (Rp prefix, optional, helper "Kosongkan untuk tampil 'Harga via WA'") · Deskripsi · Tipe (segmented Pre-order / Ready stock) + Batas order (date, optional, helper) · Tampilkan di website (switch) + Urutan tampil (number input, helper "Angka kecil tampil lebih dulu"). The products list and the storefront menu follow this order.
- **Foto & video:** drop zone (`--info-bg`, 1.5px dashed `--link` at 40%, butter burst icon, title, limits text "Foto JPG, PNG, WebP, HEIC maks. 10 MB · Video MP4, MOV maks. 50 MB / 30 detik"), then a 3-column media grid (square, `r-sm`): "Utama" badge on the main photo, video tiles with a play button and duration chip, remove ✕ on hover/focus (always visible on touch), and uploading tiles with a percentage + segmented progress. Hint: tap to set main, drag to reorder.
- **Sticky action bar:** Danger "Hapus produk" left, Line "Batal" + Primary "Simpan perubahan" right. On mobile it sits above the bottom nav.
- **Delete confirmation:** "Hapus produk" opens a small `<dialog>` (max 400px, radius 24px, padding 28px): title "Hapus {nama produk}?", text "Produk beserta semua foto dan videonya akan dihapus permanen. Pesanan lama tetap tersimpan.", then Line "Batal" and Danger "Hapus". Focus starts on "Batal".

### Order detail

Two columns (1.4fr / 1fr). Left panel: item lines (thumb, name, unit × qty, line total; unpriced lines show "—"), subtotal row above a 1px `--ink` rule with "+ n item tanpa harga", customer data as a definition list (name, WhatsApp number, pickup or delivery, address, requested date; 140px label column, stacked on mobile), and a note box (`--surface-2`). Right: **status picker** (4 full-width 44px options with a colored dot; selected = `--ink` border + inset ring) and the history feed. Any status can be picked from any other, and each change adds a row to the history. Header action: WhatsApp button "Buka chat WhatsApp", which opens a chat with the customer's number.

### Login

Centered 400px card (`--surface`, radius 24px, padding 36px 32px) over the page background with two large decorative bursts (butter top-right, sky bottom-left). Logo 64px, eyebrow "Admin", title, subtitle, a generic error alert (`--error-bg` / `--error`, "Email atau password salah." — never reveal whether the email exists or how many attempts remain), email and password fields, full-width Primary "Masuk", and the footnote "Lupa password? Hubungi pengelola website." The theme toggle sits in the top-left corner.

## 8. Accessibility Notes

- All text meets WCAG 2.1 AA in **both themes** (see 2.5). Pastels only carry `--on-accent` text.
- Visible focus everywhere: 2px `--link` outline.
- Dialogs use native `<dialog>` + `showModal()` (focus trap, Esc to close, inert background). Close buttons have `aria-label="Tutup"`. Backdrop click also closes.
- Form errors: `aria-invalid`, a text message next to the field, focus moved to the first invalid field. Color is never the only signal.
- Toggles use the right roles: chips/segments `aria-pressed`, switches `role="switch"` + `aria-checked`, current nav `aria-current="page"`.
- The delete confirmation opens with focus on "Batal", so Enter never deletes by accident.
- The toast is `role="status"`. The cart count is also available inside the cart button's accessible name context.
- Decorative elements (sticker, marquee, bursts, placeholder marks) are `aria-hidden` or have empty `alt`. Product photos use the product name as `alt`. Charts have a text summary in `aria-label`.
- Order and product status always have a text label (tags, badges, pills), never color alone.
- `prefers-reduced-motion` disables all animation, including the live-dot pulse and marquee.
- `prefers-reduced-transparency` and `prefers-contrast: more` make the translucent nav / admin top bar solid `--bg` with no blur.
- Tap targets ≥ 42px for primary actions; smaller controls get an extended hit area (see Buttons). The mobile bottom nav and cart bar respect `env(safe-area-inset-bottom)`.

## 9. Open Questions

- **Logo file:** the IG logo has a cream square background, which shows as a cream disc inside bursts (in both themes). A transparent PNG/SVG from the owner would look cleaner.
- **Product photos:** placeholders until the owner uploads originals. Photos should be shot consistently (same light and background) so the 4/5 grid looks even.
- **Fonts:** load Switzer from the Fontshare CDN, or self-host it (better performance and privacy)? Decide during project setup.
- **Copy:** headline, descriptions, checkout helper texts and the CTA are drafts and need the owner's review.
