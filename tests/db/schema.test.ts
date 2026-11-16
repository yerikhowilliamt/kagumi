// Proves the applied schema matches docs/erd.md (§2 fields, §5 indexes, CHECKs, FKs) on the
// development branch. Expected values are written from the ERD, not copied from schema.prisma.
// Writes happen only inside transactions that are always rolled back. Orders get explicit ids,
// because ROLLBACK does not undo nextval(); the last test checks orders_id_seq did not move.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDevelopmentDatabase, seedProducts } from "../../prisma/seed.ts";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set: tests/db needs the development branch in .env");
}
assertDevelopmentDatabase();

const { db } = await import("@/lib/db");

afterAll(() => db.$disconnect());

const TS = "timestamp(6) with time zone";
const NOW = "CURRENT_TIMESTAMP";
const req = (type: string, def: string | null = null) => `${type} NOT NULL${def ? ` DEFAULT ${def}` : ""}`;
const opt = (type: string) => `${type} NULL`;
const vc = (n: number) => `character varying(${n})`;

// ERD §2, one entry per column: type, nullability, default.
const COLUMNS: Record<string, Record<string, string>> = {
  admin_users: {
    id: req("uuid"),
    email: req(vc(254)),
    password_hash: req(vc(255)),
    failed_attempts: req("integer", "0"),
    locked_until: opt(TS),
    created_at: req(TS, NOW),
    updated_at: req(TS),
  },
  sessions: {
    id: req("uuid"),
    admin_id: req("uuid"),
    token_hash: req("character(64)"),
    expires_at: req(TS),
    created_at: req(TS, NOW),
  },
  products: {
    id: req("uuid"),
    name: req(vc(80)),
    category: req(vc(40)),
    description: req(vc(500), "''::character varying"),
    price: opt("integer"),
    type: req('"ProductType"'),
    order_deadline: opt("date"),
    is_active: req("boolean", "true"),
    sort_order: req("integer", "0"),
    created_at: req(TS, NOW),
    updated_at: req(TS),
  },
  product_media: {
    id: req("uuid"),
    product_id: req("uuid"),
    public_id: req(vc(255)),
    kind: req('"MediaKind"'),
    version: req("integer"),
    format: req(vc(10)),
    width: req("integer"),
    height: req("integer"),
    bytes: req("integer"),
    duration_sec: opt("real"),
    is_main: req("boolean", "false"),
    sort_order: req("integer", "0"),
    created_at: req(TS, NOW),
  },
  orders: {
    id: req("integer", "nextval('orders_id_seq'::regclass)"),
    customer_name: req(vc(80)),
    customer_phone: req(vc(15)),
    fulfillment: req('"Fulfillment"'),
    address: opt(vc(300)),
    requested_date: req("date"),
    note: opt(vc(500)),
    status: req('"OrderStatus"', `'NEW'::"OrderStatus"`),
    created_at: req(TS, NOW),
    updated_at: req(TS),
  },
  order_items: {
    id: req("uuid"),
    order_id: req("integer"),
    product_id: opt("uuid"),
    product_name: req(vc(80)),
    unit_price: opt("integer"),
    quantity: req("integer"),
  },
  order_status_changes: {
    id: req("uuid"),
    order_id: req("integer"),
    from_status: opt('"OrderStatus"'),
    to_status: req('"OrderStatus"'),
    created_at: req(TS, NOW),
  },
  events: {
    id: req("bigint", "nextval('events_id_seq'::regclass)"),
    type: req('"EventType"'),
    product_id: opt("uuid"),
    visitor_hash: req("character(64)"),
    created_at: req(TS, NOW),
  },
  rate_limits: {
    key: req(vc(100)),
    window_start: req(TS),
    count: req("integer", "1"),
  },
  pending_deletions: {
    id: req("uuid"),
    public_id: req(vc(255)),
    kind: req('"MediaKind"'),
    attempts: req("integer", "0"),
    last_error: opt(vc(500)),
    created_at: req(TS, NOW),
  },
};

describe("schema matches the ERD", { timeout: 60_000 }, () => {
  it("has exactly the 10 ERD tables", async () => {
    const rows = await db.$queryRaw<{ name: string }[]>`
      SELECT tablename::text AS name FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`;
    expect(rows.map((r) => r.name)).toEqual(Object.keys(COLUMNS).sort());
  });

  it("has the 5 enums with their exact values", async () => {
    const rows = await db.$queryRaw<{ name: string; vals: string[] }[]>`
      SELECT t.typname::text AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS vals
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
      GROUP BY t.typname`;
    expect(Object.fromEntries(rows.map((r) => [r.name, r.vals]))).toEqual({
      ProductType: ["PRE_ORDER", "READY_STOCK"],
      MediaKind: ["IMAGE", "VIDEO"],
      Fulfillment: ["PICKUP", "DELIVERY"],
      OrderStatus: ["NEW", "CONFIRMED", "COMPLETED", "CANCELLED"],
      EventType: ["PAGE_VIEW", "PRODUCT_VIEW", "ADD_TO_CART", "CHECKOUT"],
    });
  });

  it("has every column with the ERD type, length, nullability and default", async () => {
    const rows = await db.$queryRaw<{ tbl: string; col: string; def: string }[]>`
      SELECT c.relname::text AS tbl, a.attname::text AS col,
        format_type(a.atttypid, a.atttypmod)
          || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' NULL' END
          || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') AS def
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r'
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relname <> '_prisma_migrations'`;
    const actual: Record<string, Record<string, string>> = {};
    for (const r of rows) (actual[r.tbl] ??= {})[r.col] = r.def;
    expect(actual).toEqual(COLUMNS);
  });

  it("has the 5 CHECK constraints of ERD §5", async () => {
    const rows = await db.$queryRaw<{ name: string; def: string }[]>`
      SELECT con.conname::text AS name, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace AND n.nspname = 'public'
      WHERE con.contype = 'c'`;
    expect(Object.fromEntries(rows.map((r) => [r.name, r.def]))).toEqual({
      products_price_check: "CHECK (((price IS NULL) OR (price > 0)))",
      order_items_unit_price_check: "CHECK (((unit_price IS NULL) OR (unit_price > 0)))",
      order_items_quantity_check: "CHECK (((quantity >= 1) AND (quantity <= 50)))",
      orders_delivery_address_check:
        `CHECK (((fulfillment <> 'DELIVERY'::"Fulfillment") OR ((address IS NOT NULL) AND (length(TRIM(BOTH FROM address)) > 0))))`,
      product_media_bytes_check: "CHECK ((bytes > 0))",
    });
  });

  it("has every ERD index, the unique keys and the partial unique index", async () => {
    const rows = await db.$queryRaw<{ def: string }[]>`
      SELECT indexdef AS def FROM pg_indexes
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    const idx = (name: string, table: string, cols: string, unique = false, where = "") =>
      `CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON public.${table} USING btree (${cols})${where}`;
    const pkeys = Object.keys(COLUMNS).map((t) =>
      idx(`${t}_pkey`, t, t === "rate_limits" ? "key, window_start" : "id", true),
    );
    expect(rows.map((r) => r.def).sort()).toEqual(
      [
        ...pkeys,
        idx("admin_users_email_key", "admin_users", "email", true),
        idx("sessions_token_hash_key", "sessions", "token_hash", true),
        idx("sessions_expires_at_idx", "sessions", "expires_at"),
        idx("products_is_active_sort_order_idx", "products", "is_active, sort_order"),
        idx("product_media_public_id_key", "product_media", "public_id", true),
        idx("product_media_product_id_sort_order_idx", "product_media", "product_id, sort_order"),
        idx("product_media_one_main_per_product", "product_media", "product_id", true, " WHERE is_main"),
        idx("orders_status_created_at_idx", "orders", "status, created_at DESC"),
        idx("orders_created_at_idx", "orders", "created_at"),
        idx("order_items_order_id_idx", "order_items", "order_id"),
        idx("order_items_product_id_idx", "order_items", "product_id"),
        idx("order_status_changes_order_id_created_at_idx", "order_status_changes", "order_id, created_at"),
        idx("events_created_at_idx", "events", "created_at"),
        idx("events_type_product_id_created_at_idx", "events", "type, product_id, created_at"),
        idx("rate_limits_window_start_idx", "rate_limits", "window_start"),
        idx("pending_deletions_public_id_key", "pending_deletions", "public_id", true),
      ].sort(),
    );
  });

  it("has the 6 foreign keys with their ERD on-delete rule", async () => {
    const rows = await db.$queryRaw<{ fk: string }[]>`
      SELECT src.relname || '.' || sa.attname || ' -> ' || dst.relname || '.' || da.attname || ' '
        || CASE con.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
             WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' ELSE 'SET DEFAULT' END AS fk
      FROM pg_constraint con
      JOIN pg_namespace n ON n.oid = con.connamespace AND n.nspname = 'public'
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_class dst ON dst.oid = con.confrelid
      JOIN pg_attribute sa ON sa.attrelid = con.conrelid AND sa.attnum = con.conkey[1]
      JOIN pg_attribute da ON da.attrelid = con.confrelid AND da.attnum = con.confkey[1]
      WHERE con.contype = 'f' AND cardinality(con.conkey) = 1`;
    const total = await db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_constraint con
      JOIN pg_namespace n ON n.oid = con.connamespace AND n.nspname = 'public' WHERE con.contype = 'f'`;
    expect(total[0].n).toBe(6);
    expect(rows.map((r) => r.fk).sort()).toEqual(
      [
        "sessions.admin_id -> admin_users.id CASCADE",
        "product_media.product_id -> products.id CASCADE",
        "order_items.order_id -> orders.id CASCADE",
        "order_items.product_id -> products.id SET NULL",
        "order_status_changes.order_id -> orders.id CASCADE",
        "events.product_id -> products.id SET NULL",
      ].sort(),
    );
  });
});

// Constraint behavior: each case runs in its own transaction, which is always rolled back.
const ROLLBACK = new Error("rollback");
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function inRolledBackTx(fn: (tx: Tx) => Promise<void>) {
  await expect(
    db.$transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    }),
  ).rejects.toBe(ROLLBACK);
}

async function expectRejected(constraint: string, fn: (tx: Tx) => Promise<unknown>) {
  let error: unknown;
  try {
    await db.$transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    error = e;
  }
  expect(error, `${constraint} did not reject the row`).not.toBe(ROLLBACK);
  expect(String((error as Error)?.message)).toContain(constraint);
}

async function insertProduct(tx: Tx, price: number | null = null) {
  const [p] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO products (id, name, category, price, type, updated_at)
    VALUES (gen_random_uuid(), 'schema-test', 'test', ${price}, 'READY_STOCK', now()) RETURNING id::text`;
  return p.id;
}

let nextOrderId = -1; // negative ids never collide with real orders and skip the sequence

async function insertOrder(tx: Tx, fulfillment: string, address: string | null) {
  const [o] = await tx.$queryRaw<{ id: number }[]>`
    INSERT INTO orders (id, customer_name, customer_phone, fulfillment, address, requested_date, updated_at)
    VALUES (${nextOrderId--}, 'schema-test', '6281200000000', ${fulfillment}::"Fulfillment", ${address}, current_date, now())
    RETURNING id`;
  return o.id;
}

const ordersSeq = async () =>
  (await db.$queryRaw<{ v: string | null }[]>`
    SELECT last_value::text AS v FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'orders_id_seq'`)[0].v;
let seqBefore: string | null;
beforeAll(async () => {
  seqBefore = await ordersSeq();
});

async function insertMedia(tx: Tx, productId: string, bytes: number, isMain: boolean) {
  await tx.$executeRaw`
    INSERT INTO product_media (id, product_id, public_id, kind, version, format, width, height, bytes, is_main)
    VALUES (gen_random_uuid(), ${productId}::uuid, gen_random_uuid()::text, 'IMAGE', 1, 'jpg', 1, 1, ${bytes}, ${isMain})`;
}

async function insertItem(tx: Tx, unitPrice: number | null, quantity: number) {
  const orderId = await insertOrder(tx, "PICKUP", null);
  await tx.$executeRaw`
    INSERT INTO order_items (id, order_id, product_name, unit_price, quantity)
    VALUES (gen_random_uuid(), ${orderId}, 'schema-test', ${unitPrice}, ${quantity})`;
}

describe("constraints reject invalid rows", { timeout: 60_000 }, () => {
  it("accepts valid rows (control)", async () => {
    await inRolledBackTx(async (tx) => {
      const productId = await insertProduct(tx, 35000);
      await insertProduct(tx, null);
      await insertMedia(tx, productId, 1, true);
      await insertMedia(tx, productId, 1, false);
      await insertOrder(tx, "DELIVERY", "Jl. Slamet Riyadi 1");
      await insertItem(tx, null, 1);
      await insertItem(tx, 1, 50);
    });
  });

  it("products.price must be null or > 0", async () => {
    await expectRejected("products_price_check", (tx) => insertProduct(tx, 0));
  });

  it("order_items.unit_price must be null or > 0", async () => {
    await expectRejected("order_items_unit_price_check", (tx) => insertItem(tx, 0, 1));
  });

  it("order_items.quantity must be 1-50", async () => {
    await expectRejected("order_items_quantity_check", (tx) => insertItem(tx, null, 0));
    await expectRejected("order_items_quantity_check", (tx) => insertItem(tx, null, 51));
  });

  it("a DELIVERY order needs a non-blank address, including not NULL", async () => {
    await expectRejected("orders_delivery_address_check", (tx) => insertOrder(tx, "DELIVERY", null));
    await expectRejected("orders_delivery_address_check", (tx) => insertOrder(tx, "DELIVERY", "   "));
  });

  it("product_media.bytes must be > 0", async () => {
    await expectRejected("product_media_bytes_check", async (tx) => insertMedia(tx, await insertProduct(tx), 0, false));
  });

  it("a product has at most one main media", async () => {
    await expectRejected("product_media_one_main_per_product", async (tx) => {
      const productId = await insertProduct(tx);
      await insertMedia(tx, productId, 1, true);
      await insertMedia(tx, productId, 1, true);
    });
  });
});

// ERD §1 ids are uuid v7 and ERD §2 updatedAt is @updatedAt: both are set by the client, not the database.
describe("client-side defaults", { timeout: 60_000 }, () => {
  it("sets uuid v7 ids on every uuid model and maintains updatedAt", async () => {
    const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    await inRolledBackTx(async (tx) => {
      const admin = await tx.adminUser.create({ data: { email: "schema-test@example.test", passwordHash: "x" } });
      const session = await tx.session.create({
        data: { adminId: admin.id, tokenHash: "0".repeat(64), expiresAt: new Date() },
      });
      const product = await tx.product.create({ data: { name: "schema-test", category: "test", type: "READY_STOCK" } });
      const media = await tx.productMedia.create({
        data: { productId: product.id, publicId: "schema-test", kind: "IMAGE", version: 1, format: "jpg", width: 1, height: 1, bytes: 1 },
      });
      const order = await tx.order.create({
        data: { id: nextOrderId--, customerName: "schema-test", customerPhone: "6281200000000", fulfillment: "PICKUP", requestedDate: new Date() },
      });
      const item = await tx.orderItem.create({ data: { orderId: order.id, productName: "schema-test", quantity: 1 } });
      const change = await tx.orderStatusChange.create({ data: { orderId: order.id, toStatus: "NEW" } });
      const deletion = await tx.pendingDeletion.create({ data: { publicId: "schema-test", kind: "IMAGE" } });
      for (const row of [admin, session, product, media, item, change, deletion]) expect(row.id).toMatch(V7);

      const updated = await tx.product.update({ where: { id: product.id }, data: { name: "schema-test-2" } });
      expect(updated.updatedAt.getTime()).toBeGreaterThan(product.updatedAt.getTime());
    });
  });
});

// Seed contents of M0.3 note 4 (P15), written from the task file, not copied from prisma/seed.ts.
const P15 = [
  ["Bolu Gulung", "Kue", "PRE_ORDER", null, null, "Lembut dengan filling nanas, strawberry, atau blueberry.", 1],
  ["Fudgy Brownies", "Brownies", "PRE_ORDER", null, null, "Padat, nyoklat, dan moist. Ukuran 20×10 cm.", 2],
  ["Brownies Custom", "Brownies", "PRE_ORDER", null, null, "Tulisan dan dekorasi sesuai request, cocok untuk kado.", 3],
  ["Soft Cookies", "Cookies", "READY_STOCK", null, null, "Tebal, renyah di luar dan lembut di dalam.", 4],
  ["Buko Mangga", "Dessert", "READY_STOCK", null, null, "Dessert mangga segar yang creamy dan dingin.", 5],
  ["Donut", "Donut", "READY_STOCK", null, null, "", 6],
  ["Hampers Natal", "Hampers", "PRE_ORDER", 35000, "2026-12-10", "Termasuk box, paper bag, kartu & hang tag edisi Natal.", 7],
];

describe("development seed (P15)", { timeout: 60_000 }, () => {
  it("inserts the note 4 rows into an empty table, and nothing on a second run", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.product.deleteMany();
      expect(await seedProducts(tx)).toBe(7);
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT name, category, type::text, price, order_deadline::text AS deadline, description, sort_order, is_active
        FROM products ORDER BY sort_order`;
      expect(rows.map((r) => [r.name, r.category, r.type, r.price, r.deadline, r.description, r.sort_order])).toEqual(P15);
      expect(rows.every((r) => r.is_active === true)).toBe(true);
      expect(await seedProducts(tx)).toBe(0);
      expect(await tx.product.count()).toBe(7);
    });
  });

  it("inserts nothing when products already has a row", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.product.deleteMany();
      await insertProduct(tx);
      expect(await seedProducts(tx)).toBe(0);
      expect(await tx.product.count()).toBe(1);
    });
  });
});

// Runs last in this file: the rolled-back tests above must not have consumed an order id.
it("leaves orders_id_seq unchanged", async () => {
  expect(await ordersSeq()).toBe(seqBefore);
});
