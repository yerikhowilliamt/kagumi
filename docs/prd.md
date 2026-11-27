# PRD: Kagumi Dough Website

**Status:** Accepted (2026-11-15); launch scope revised 2026-11-27 (§3 goal 6, §7)
**Target launch:** before 2026-12-01 (statistics, requirements 31–35, in December)

## 1. Overview

Kagumi Dough is a homemade bakery in Surakarta (Solo) selling bolu gulung, brownies, cookies, buko mangga, donuts and seasonal hampers, by pre-order and ready stock. Today it sells only through Instagram. This project builds a storefront website where customers browse the full menu, put several products in a cart and send one prefilled order to WhatsApp. It also includes an admin dashboard where the owner manages products, photos and videos, follows orders and reads basic statistics without needing a developer.

## 2. Problem Statement

- **Customers** can't see the whole menu in one place. Products, prices and order deadlines are scattered across Instagram highlights and captions, and most regular prices aren't published at all. Ordering means starting a WhatsApp chat from scratch and typing everything by hand.
- **The owner** has no record of orders outside chat history, no view of which products people are interested in, and depends on posting stories to announce menu changes and PO deadlines.

## 3. Goals

1. A public storefront, fully in Bahasa Indonesia, that lists every active product with photo, description, optional price, order type (pre-order / ready stock) and optional order deadline.
2. A cart that turns several products and quantities into **one** prefilled WhatsApp message to the shop.
3. Every checkout is saved as an order the owner can see and update in the dashboard.
4. The owner can create, edit, hide and delete products and upload product photos and videos without developer help.
5. The owner can see visitor, product-interest and order statistics in the dashboard.
6. Goals 1–4 are live on Vercel before 2026-12-01, in time for the Christmas hampers pre-order season. Goal 5 (statistics) follows in December (decided 2026-11-27).

## 4. Non-Goals

- Online payment, payment gateways or invoices. Payment stays in WhatsApp, as today.
- Customer accounts, login or order history for customers.
- Multiple admin users, roles or permissions. One admin account only.
- Self-service admin sign-up or a "forgot password" flow. The account is created and reset with a script.
- Delivery fee calculation, maps or courier integration. Delivery details are agreed in chat.
- Stock quantity tracking. Ready stock vs pre-order is a label, not an inventory count.
- Multi-language support (Indonesian only), a native mobile app.
- A custom domain. The site uses the free `*.vercel.app` subdomain for now.
- Third-party analytics services.

## 5. Users & Use Cases

**Customer** — people in Solo and the surrounding area, mostly on mobile, usually arriving from the Instagram bio link.

- As a customer, I want to see the full menu with photos and prices, so that I know what's available before I chat.
- As a customer, I want to know if a product is ready stock or pre-order and when the PO closes, so that I order in time.
- As a customer, I want to add several products to a cart and send them in one WhatsApp message, so that I don't have to type my order.
- As a customer, I want to choose pickup or delivery and a requested date before sending, so that the shop has what it needs to confirm.

**Admin (the shop owner)** — non-technical, manages the shop from a phone or laptop.

- As the admin, I want to add and edit products and upload photos/videos from my phone, so that the menu is always current.
- As the admin, I want to hide a product or close a PO without deleting it, so that I can reuse it next season.
- As the admin, I want a list of orders that came from the website with their status, so that I can follow up and not miss any.
- As the admin, I want to see which products people look at, add to cart and order, so that I know what sells.

## 6. Requirements

### Functional Requirements

**Storefront**

1. The site must show a single home page with the sections defined in `design.md`: notice bar, navigation, hero, product marquee, menu, how to order, special-order CTA and footer (WhatsApp, Instagram, location). The notice bar and the hero promo card must reflect the pre-orders that are open at that moment, with no manual update by the admin.
2. The menu must list all products marked active, each with name, category, description, main photo (or the branded placeholder when there is none), optional price, order type tag and optional order deadline.
3. A product without a price must show "Harga via WA" instead of a price.
4. The menu must offer a filter: Semua / Ready stock / Pre-order.
5. When a product's order deadline has passed, the product must show as closed ("Order sudah ditutup"), must not be addable to the cart, and must sort after open products.
6. A customer must be able to open a product detail view that shows all its photos and videos.
7. Store content must update on the public site within 1 minute after the admin saves a change.

**Cart & checkout**

8. A customer must be able to add a product to the cart, change its quantity and remove it, from the menu and from the product detail view.
9. The cart must persist in the browser (survives a page reload) until checkout or until the customer clears it.
10. The cart must show each line (product, quantity, price when known) and a subtotal computed only from lines that have a price, labeled clearly when some lines have no price.
11. At checkout the customer must enter: name (required), WhatsApp number (required), pickup or delivery (required), delivery address (required when delivery is chosen), requested date (required), and a note (optional).
12. The system must re-check on the server that every product in the cart still exists, is active and is not closed, and must reject the checkout with a clear message if not.
13. On checkout the system must save the order (customer input, lines, quantities and the prices at that moment), then open WhatsApp (`wa.me/6285159545168`) with a prefilled message containing the order number, every line, quantities, subtotal, the customer's details and the marker "(dari website)".
14. If saving the order fails, the customer must still be able to send the WhatsApp message, so that no order is lost.

**Admin authentication**

15. The admin area (`/admin`) must require login with email and password. There must be no public sign-up page.
16. The admin account must be created and its password reset by a server-side script that reads the credentials from environment variables.
17. Passwords must be stored only as a salted hash (`crypto.scrypt`, Node built-in). No plaintext passwords anywhere.
18. Sessions must be random tokens (`crypto.randomBytes`) delivered in an `httpOnly`, `secure`, `sameSite=lax` cookie. The database must store only the SHA-256 hash of the token, never the token itself. A session expires 7 days after its last renewal, and is renewed when the admin uses it with less than 1 day left. Logout must delete the session.
19. After 5 failed logins the account must be locked for 15 minutes. Failed attempts must be recorded in the database.
20. Login must return the same error for a wrong email and a wrong password and must compare secrets with `crypto.timingSafeEqual`.
21. Every admin page, server action, API route and upload-signing endpoint must verify the session itself. Middleware alone is not sufficient.

**Admin: products & media**

22. The admin must be able to create, edit and delete products with: name, category, description, price (optional), order type (pre-order / ready stock), order deadline (optional date), active/hidden flag and display order.
23. The admin must be able to upload several photos and videos per product, pick the main photo, reorder media and delete media.
24. Uploads must go directly from the browser to Cloudinary using a signature issued by our server only to a logged-in admin.
25. Uploads must be limited to images (JPEG, PNG, WebP, HEIC) up to 10 MB and videos (MP4, MOV) up to 50 MB and 30 seconds.
26. The storefront must serve media through Cloudinary transformations (resized, modern formats) so that the original phone files are never sent to customers.
27. Deleting a product must ask for confirmation and must also delete its media from Cloudinary.

**Admin: orders**

28. The admin must see a list of website orders, newest first, with order number, date, customer name, pickup/delivery, requested date, item count, subtotal and status.
29. The admin must be able to open an order to see every detail, open a WhatsApp chat with the customer's number, and change its status. The statuses are Baru, Dikonfirmasi, Selesai and Dibatalkan. The usual flow is Baru → Dikonfirmasi → Selesai, but the admin may set any status from any other (to correct a mistake), and every change must be recorded in the order's history.
30. The order list must be filterable by status and searchable by customer name or order number.

**Admin: statistics**

31. The system must record four events: `page_view`, `product_view`, `add_to_cart` and `checkout`. The browser sends the first three to our own endpoint (`navigator.sendBeacon`). `checkout` is recorded by the server when the order is saved, never accepted from the browser.
32. The tracking endpoint must accept only the three browser event names and known product IDs, must ignore known bot user agents and must rate-limit each visitor.
33. Unique visitors must be counted with a hash of IP + user agent + a salt that changes daily. Raw IP addresses must not be stored, and no tracking cookie is used.
34. Raw events older than 90 days must be deleted automatically.
35. The dashboard must show for the last 7 and 30 days: visitors and page views per day, top products by views, add-to-carts and orders, the funnel visitors → add to cart → checkout with percentages, and order counts per status. The headline numbers and the visitors chart must also show the change against the previous period of the same length.

**Theming**

36. The storefront and the admin must support a light and a dark theme. The default follows the device setting, and a toggle lets the user override it. The choice is remembered in the browser and shared by the storefront and the admin.

### Non-Functional Requirements

- **Performance:** the home page must be statically rendered and revalidated on admin changes. Target Lighthouse mobile Performance ≥ 90 and LCP < 2.5 s on 4G.
- **Mobile first:** every storefront and admin screen must work at 360 px width without horizontal scrolling. The admin is expected to be used from a phone.
- **Accessibility:** WCAG 2.1 AA as defined in `design.md` (contrast, visible focus, reduced motion, labeled controls).
- **Security:** all input validated on the server, secrets only in environment variables, parameterized queries only, admin routes protected as in requirements 15–21.
- **Cost:** must run on free tiers: Vercel Hobby, Neon Free, Cloudinary Free.
- **Dependencies:** authentication and statistics are built in-house with Node built-ins. No auth library and no analytics service.
- **Reliability:** an order must never be lost because of a backend failure (see requirement 14).

## 7. Success Metrics

The MVP is measured simply:

- **Primary:** the number of WhatsApp orders carrying the "(dari website)" marker per week, compared with the owner's total orders.
- **Secondary (from the dashboard):** visitor → checkout conversion and the most-ordered products.
- **Launch criterion:** all functional requirements above except 31–35 (statistics) are live on the production URL before 2026-12-01, and the owner has added the real menu herself through the dashboard. Requirements 31–35 follow in December (decided 2026-11-27: products and media finished after their latest date, and the owner needs the days before launch to enter the menu).

## 8. Assumptions & Open Questions

**Assumptions**

- The shop's WhatsApp number stays `0851-5954-5168`.
- Order traffic is small (tens of orders per week), well within the free-tier limits.
- The owner can supply product photos (and ideally a transparent logo) before launch. Until then the branded placeholder is used.
- Delivery is limited to Surakarta and the surrounding area. Fees and areas are agreed in chat.
- Tech stack: Next.js (App Router), Neon (Postgres), Cloudinary, Vercel. Details are covered in the System Design document.

**Open questions**

- Regular prices for each product. They're optional in the data model and can be filled in later by the owner.
- Final copy (headline, product descriptions, CTA text) needs the owner's review.
- Should orders past their requested date be auto-marked, or left to the admin? Default: left to the admin.

## 9. Risks & Trade-offs

- **Timeline (high):** about two weeks for the storefront, cart, orders, custom auth, media management and statistics. Any slip lands in the hampers season. Mitigation: build in this order — storefront + cart → orders → auth → product management → media → statistics — so the most valuable parts are done first.
- **Vercel Hobby is for non-commercial use:** a shop website may breach the Hobby plan's terms. The owner accepts this for now. If Vercel flags it, upgrading to Pro needs no code changes.
- **Custom authentication:** building auth in-house avoids a dependency but puts the security details on us (hashing, sessions, lockout, per-action checks). Requirements 15–21 exist to cover them and must be reviewed before launch.
- **Custom statistics:** gives business events that free hosted analytics don't, but every visit writes to Neon. This keeps the database awake and uses Neon's free compute hours. It's acceptable at current traffic, but should be watched.
- **Free-tier limits:** Neon Free (0.5 GB, compute hours, auto-suspend causing a short cold start on the first admin request) and Cloudinary Free (25 monthly credits, which video uses up fastest). Upload limits in requirement 25 keep usage down.
- **WhatsApp as the order channel:** an order saved on the site may never actually be sent in WhatsApp (the customer closes the tab). Saved orders therefore start as "Baru" and are confirmed by the admin only after the chat arrives. If no chat arrives, the admin can contact the customer on the WhatsApp number given at checkout.
- **Instagram-only media:** current images are low-resolution story screenshots. The site looks best only after the owner uploads proper photos.

---

Related documents: [System Design](system-design.md), [ERD](erd.md), [Design System](design.md), [ADRs](adrs/README.md).
