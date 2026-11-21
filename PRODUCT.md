# Product

<!-- uizze:product-schema 1 -->

This file is the short product record the design tooling reads. `docs/prd.md` owns scope and requirements; when the two differ, `docs/prd.md` wins and this file is corrected. Visual decisions live in `docs/design.md`, not here.

## Platform

web

## Users

- **Customer.** People in Surakarta (Solo) and the surrounding area, mostly on a phone, usually arriving from the Instagram bio link. They want to see the whole menu with photos and prices, know whether a product is ready stock or pre-order and when the pre-order closes, and send one order without typing it by hand.
- **Admin (the shop owner).** One non-technical person who runs the shop from a phone or a laptop. She keeps the menu current, follows the orders that came from the website, and reads which products people look at and order. There is one admin account and no other role.

## Product Purpose

Kagumi Dough is a homemade bakery in Solo that sells bolu gulung, brownies, cookies, buko mangga, donuts and seasonal hampers, by pre-order and ready stock. Until now it sold only through Instagram, where prices and order deadlines are scattered across highlights and captions.

The website gives customers the full menu in one place and a cart that becomes one prefilled WhatsApp message to the shop. It gives the owner a dashboard to manage products and media, follow orders and read basic statistics without a developer.

Success is measured by the number of WhatsApp orders per week that carry the "(dari website)" marker, compared with the owner's total orders. Target launch is before 2026-12-01, in time for the Christmas hampers pre-order season.

## Positioning

Homemade, and baked fresh per order rather than taken from factory stock (owner's answer, 2026-11-21).

Some products are sold as ready stock, so "baked to order" is a claim about the shop, not about every product: a product tagged ready stock must not be described as made after ordering.

## Operating Context

- Customers come from Instagram and finish in WhatsApp. The site sits between the two: it prepares the order, and the conversation, the payment and the delivery details stay in the WhatsApp chat.
- An order saved on the site starts as "Baru". The owner confirms it only after the customer's chat arrives, then moves it to "Dikonfirmasi" and "Selesai", or "Dibatalkan".
- Pre-orders have a deadline. A product past its deadline shows as closed and cannot be added to the cart.
- The owner is expected to use the admin from her phone, between baking and replying to chats.
- Order volume is small: tens of orders per week.

## Capabilities and Constraints

- Storefront: one home page with the menu, a filter (Semua / Ready stock / Pre-order), product detail with photos and videos, a cart kept in the browser, and a checkout form (name, WhatsApp number, pickup or delivery, address when delivery, requested date, optional note).
- A product without a price shows "Harga via WA". The subtotal counts only lines that have a price and says so.
- If saving the order fails, the customer can still send the WhatsApp message. An order must never be lost.
- Admin: products and media, orders with status and history, statistics for the last 7 and 30 days.
- Order statuses: Baru, Dikonfirmasi, Selesai, Dibatalkan. Any status can be set from any other, and every change is recorded.
- Not in the product: online payment, customer accounts, more than one admin, stock counts, delivery fee calculation, other languages, a native app, a custom domain, third-party analytics.
- Must run on free tiers (Vercel Hobby, Neon Free, Cloudinary Free).
- Every storefront and admin screen works at 360 px width without horizontal scrolling.
- Open, not decided: regular prices for each product (optional in the data, filled in later by the owner).

## Brand Commitments

- Name: Kagumi Dough. Logo: the shop's Instagram logo, a blue scalloped badge with cream lettering and doodles.
- All site copy, storefront and admin, is in Bahasa Indonesia.
- The shop's WhatsApp number is `0851-5954-5168`.
- The visual system is the accepted `docs/design.md`.
- Voice is not confirmed. The headline, product descriptions, checkout helper texts and the CTA are drafts that need the owner's review.

## Evidence on Hand

None yet (owner's answer, 2026-11-21). Future work must not invent any of the following:

- No original product photos. The site uses the branded placeholder until the owner uploads photos; the current Instagram images are low-resolution story screenshots.
- No customer testimonials or reviews.
- No transparent logo. The Instagram logo has a cream square background.
- No published regular prices for most products.

## Product Principles

1. **No order is lost.** A backend failure never stops the customer from sending the order in WhatsApp.
2. **WhatsApp stays the counter.** The site prepares the order and records it. It does not replace the chat, the payment or the delivery arrangement.
3. **The owner runs it alone, from her phone.** Every admin task works without a developer and at 360 px.
4. **Show only what is true now.** Open and closed pre-orders follow the deadline, a missing price says "Harga via WA", and nothing is shown that the shop does not have: no invented photos, reviews or prices.
5. **Small and free to run.** Choices fit tens of orders per week on free tiers.

## Accessibility & Inclusion

WCAG 2.1 AA as defined in `docs/design.md`: contrast, visible focus, reduced motion and labeled controls, in both the light and the dark theme.
