const express = require("express");
const serverless = require("serverless-http");
const cors = require("cors");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");

const { validateCoupons, recordUsage } = require("./lib/couponService");
const { storeImage, removeImage, removeImagesByPrefix } = require("./lib/storageService");

const SECRET_KEY = process.env.JWT_SECRET_KEY || process.env.SECRET_KEY || "dev-only-change-me";
const SECURITY_MODE = (process.env.CAKELY_SECURITY_MODE || "normal").toLowerCase();
const PRODUCT_BUCKET = process.env.SUPABASE_PRODUCT_BUCKET || "product-images";
const CUSTOM_CAKE_BUCKET = process.env.SUPABASE_CUSTOM_CAKE_BUCKET || "custom-cakes";
const RULELOCK_API_URL = process.env.RULELOCK_API_URL || null;
const RULELOCK_API_TOKEN = process.env.RULELOCK_API_TOKEN || null;
const RULELOCK_TIMEOUT_MS = Number(process.env.RULELOCK_TIMEOUT_MS || 4000);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const app = express();

// Strip the Netlify function path prefix so routes below can be defined
// exactly like the original Flask `/api/...` routes, minus the `/api`.
app.use((req, _res, next) => {
  req.url = req.url.replace(/^(\/\.netlify\/functions\/api|\/api)/, "") || "/";
  next();
});

const frontendOrigins = (process.env.FRONTEND_URL || "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin: frontendOrigins.length ? frontendOrigins : true,
    credentials: frontendOrigins.length > 0,
  })
);
app.use(express.json());

// ---------- one-time-per-cold-start admin bootstrap ----------
let adminEnsured = false;
async function ensureAdmin() {
  if (adminEnsured) return;
  adminEnsured = true;
  try {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123";
    const email = `${username}@cakely.lk`;
    const passwordHash = await bcrypt.hash(password, 10);
    const { data: existing } = await supabase.from("users").select("id").or(`username.eq.${username},email.eq.${email}`).maybeSingle();
    if (existing) {
      await supabase.from("users").update({ username, is_admin: true, password_hash: passwordHash }).eq("id", existing.id);
    } else {
      await supabase.from("users").insert({ username, email, is_admin: true, password_hash: passwordHash });
    }
  } catch (err) {
    console.error("ensureAdmin failed:", err.message);
  }
}

// ---------- helpers ----------
function tokenFor(user) {
  return jwt.sign({ sub: String(user.id) }, SECRET_KEY, { algorithm: "HS256", expiresIn: "2d" });
}

async function currentUser(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return { user: null, error: null };
  try {
    const claims = jwt.verify(header.slice(7), SECRET_KEY, { algorithms: ["HS256"] });
    const { data } = await supabase.from("users").select("*").eq("id", Number(claims.sub)).maybeSingle();
    return { user: data || null, error: null };
  } catch (err) {
    if (err.name === "TokenExpiredError") return { user: null, error: { code: "TOKEN_EXPIRED", message: "Your session has expired. Please log in again." } };
    return { user: null, error: { code: "INVALID_TOKEN", message: "Your session is invalid. Please log in again." } };
  }
}

function authErrorResponse(res, error, defaultMessage = "Please sign in.") {
  if (error) return res.status(401).json({ success: false, error });
  return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: defaultMessage } });
}

async function requireAdmin(req, res) {
  const { user, error } = await currentUser(req);
  if (!user || !user.is_admin) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Administrator access required." } });
    return null;
  }
  return user;
}

async function record(eventType, metadata = {}, userId = null, orderId = null, sessionId = null) {
  const eventId = `evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  await supabase.from("transaction_events").insert({ event_id: eventId, event_type: eventType, metadata: { session_id: sessionId, ...metadata }, user_id: userId, order_id: orderId });
}

async function isRulelockEnabled() {
  const { data } = await supabase
    .from("transaction_events")
    .select("metadata")
    .eq("event_type", "RULELOCK_SETTING_CHANGED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.metadata?.enabled === true;
}

async function reviewWithRuleLock({ orderId, sessionId, accountId, coupons, discount, items, subtotal, total, paymentMethod, accountVerified, pastOrders, pastRefusals }) {
  if (!RULELOCK_API_URL) return { decision: "accept", reason: "RuleLock not configured" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RULELOCK_TIMEOUT_MS);
  try {
    const response = await fetch(RULELOCK_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(RULELOCK_API_TOKEN ? { Authorization: `Bearer ${RULELOCK_API_TOKEN}` } : {}),
        "X-Session-ID": sessionId || "",
      },
      body: JSON.stringify({
        order_id: orderId,
        account_id: accountId,
        session_id: sessionId,
        coupons_applied: coupons,
        discount_value: discount,
        sku: items[0]?.productId ?? "",
        quantity: items.reduce((sum, item) => sum + Number(item.quantity || 1), 0),
        subtotal,
        total,
        account_verified: accountVerified,
        past_orders: pastOrders,
        past_refusals: pastRefusals,
        payment_method: paymentMethod,
      }),
    });
    if (!response.ok) throw new Error(`RuleLock responded ${response.status}`);
    return await response.json();
  } catch (err) {
    return { decision: "hold", reason: `RuleLock unreachable (${err.message})` };
  } finally {
    clearTimeout(timeout);
  }
}

async function codHistory(userId) {
  const { data } = await supabase.from("orders").select("status").eq("user_id", userId).eq("payment_method", "COD");
  const rows = data || [];
  return {
    pastOrders: rows.length,
    pastRefusals: rows.filter((row) => row.status === "CANCELLED").length,
  };
}

function productAsDict(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category,
    basePrice: Number(row.base_price),
    image: row.image,
    imageKey: row.image_key || null,
    flavours: row.flavours,
    sizes: row.sizes,
    active: row.active,
  };
}

// naive in-memory rate limiter (per warm function instance only — see README)
function rateLimit(maxHits, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.headers["x-nf-client-connection-ip"] || req.ip || "anon";
    const now = Date.now();
    const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > maxHits) {
      return res.status(429).json({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests, please slow down." } });
    }
    next();
  };
}

app.use(async (req, _res, next) => {
  await ensureAdmin();
  next();
});

// ---------- routes ----------
app.get("/health", async (_req, res) => {
  const { error } = await supabase.from("products").select("id", { count: "exact", head: true });
  if (error) {
    return res.status(503).json({
      success: false,
      service: "cakely-api",
      database: "unavailable",
      error: { code: "DATABASE_UNAVAILABLE", message: "Database connection is not ready." },
    });
  }
  res.json({ success: true, service: "cakely-api", database: "connected" });
});

app.get("/products", async (req, res) => {
  let query = supabase.from("products").select("*").eq("active", true).order("id");
  const { category, search } = req.query;
  if (category && category !== "All cakes") query = query.eq("category", category);
  if (search) query = query.ilike("name", `%${search}%`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  res.json({ success: true, data: data.map(productAsDict) });
});

app.get("/products/:slug", async (req, res) => {
  const { data } = await supabase.from("products").select("*").eq("slug", req.params.slug).eq("active", true).maybeSingle();
  if (!data) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found." } });
  res.json({ success: true, data: productAsDict(data) });
});

app.get("/coupons", async (_req, res) => {
  const { data, error } = await supabase.from("coupons").select("*").eq("active", true).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  res.json({
    success: true,
    data: (data || []).map((row) => ({
      code: row.code,
      description: row.description,
      discountType: row.discount_type,
      discountValue: Number(row.discount_value),
      minimumOrder: Number(row.minimum_order),
      freeDelivery: row.free_delivery || row.discount_type === "FREE_DELIVERY",
      canStack: row.can_stack,
      codApplicable: row.cod_applicable,
    })),
  });
});

app.post("/auth/register", rateLimit(5, 60_000), async (req, res) => {
  const data = req.body || {};
  const username = String(data.username || "").trim();
  const email = String(data.email || "").trim().toLowerCase();
  if (!username || !email || !data.password || String(data.password).length < 8) {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Use a username, email, and password of at least 8 characters." } });
  }
  const { data: existing } = await supabase.from("users").select("id").or(`email.eq.${email},username.eq.${username}`).maybeSingle();
  if (existing) return res.status(409).json({ success: false, error: { code: "USER_EXISTS", message: "That account already exists." } });
  const passwordHash = await bcrypt.hash(data.password, 10);
  const { data: user, error } = await supabase.from("users").insert({ username, email, password_hash: passwordHash }).select().single();
  if (error?.code === "23505") return res.status(409).json({ success: false, error: { code: "USER_EXISTS", message: "That username or email is already registered." } });
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  await record("REGISTER", { email: user.email }, null, null, req.headers["x-session-id"] || null);
  res.status(201).json({ success: true, data: { token: tokenFor(user), user: { username: user.username, isAdmin: false } } });
});

app.post("/auth/login", rateLimit(10, 60_000), async (req, res) => {
  const data = req.body || {};
  const identifier = data.identifier || data.email || data.username;
  const { data: user } = await supabase.from("users").select("*").or(`email.eq.${identifier},username.eq.${identifier}`).maybeSingle();
  if (!user || !(await bcrypt.compare(data.password || "", user.password_hash))) {
    return res.status(401).json({ success: false, error: { code: "INVALID_LOGIN", message: "Username/email or password is incorrect." } });
  }
  await record("LOGIN", { role: user.is_admin ? "admin" : "customer" }, user.id, null, req.headers["x-session-id"] || null);
  res.json({ success: true, data: { token: tokenFor(user), user: { username: user.username, isAdmin: user.is_admin } } });
});

app.get("/auth/me", async (req, res) => {
  const { user, error } = await currentUser(req);
  if (!user) return authErrorResponse(res, error);
  res.json({ success: true, data: { username: user.username, email: user.email, isAdmin: user.is_admin } });
});

app.get("/addresses", async (req, res) => {
  const { user } = await currentUser(req);
  if (!user) return authErrorResponse(res);
  const { data, error } = await supabase.from("addresses").select("*").eq("user_id", user.id).order("is_default", { ascending: false }).order("created_at", { ascending: false });
  if (error && /addresses|schema cache/i.test(error.message || "")) return res.json({ success: true, data: [] });
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  res.json({ success: true, data: data || [] });
});

app.post("/addresses", async (req, res) => {
  const { user } = await currentUser(req);
  if (!user) return authErrorResponse(res);
  const data = req.body || {};
  if (!data.recipient || !data.phone || !data.address || !data.city || !data.district) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Recipient, phone, address, city, and district are required." } });
  if (data.isDefault) await supabase.from("addresses").update({ is_default: false }).eq("user_id", user.id);
  const { data: row, error } = await supabase.from("addresses").insert({ user_id: user.id, label: data.label || "Home", recipient: data.recipient, phone: data.phone, address: data.address, city: data.city, district: data.district, postal_code: data.postalCode || null, is_default: !!data.isDefault }).select().single();
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  res.status(201).json({ success: true, data: row });
});

app.delete("/addresses/:id", async (req, res) => {
  const { user } = await currentUser(req);
  if (!user) return authErrorResponse(res);
  const { error } = await supabase.from("addresses").delete().eq("id", Number(req.params.id)).eq("user_id", user.id);
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  res.json({ success: true });
});

app.post("/checkout", async (req, res) => {
  const { user } = await currentUser(req);
  const data = req.body || {};
  const items = data.items || [];
  const sessionId = req.headers["x-session-id"] || null;
  if (!user || user.is_admin) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Please sign in before adding items or placing an order." } });
  }
  if (!items.length || !data.address || !["COD", "CARD", "BANK"].includes(data.paymentMethod)) {
    return res.status(400).json({ success: false, error: { code: "CHECKOUT_INVALID", message: "Complete your cart, address, and payment method." } });
  }

  let subtotal = 0;
  const verifiedItems = [];
  for (const entry of items) {
    const { data: item } = await supabase.from("products").select("*").eq("id", entry.productId).maybeSingle();
    const quantity = SECURITY_MODE === "research"
      ? Math.max(1, Number(entry.quantity || 1))
      : Math.max(1, Math.min(Number(entry.quantity || 1), 20));
    if (!item || !item.active) {
      return res.status(400).json({ success: false, error: { code: "PRODUCT_UNAVAILABLE", message: "A selected cake is unavailable." } });
    }
    const size = entry.size || "1 kg";
    const price = Number((item.sizes || {})[size] ?? item.base_price);
    subtotal += price * quantity;
    verifiedItems.push({ productId: item.id, name: item.name, size, flavour: entry.flavour, quantity, unitPrice: price });
  }

  const couponResult = await validateCoupons({ codes: data.coupons || [], subtotal, user, paymentMethod: data.paymentMethod, securityMode: SECURITY_MODE, supabase });
  const submittedDiscount = Number(data.discount || 0);
  if (submittedDiscount !== couponResult.discount) {
    await record("DISCOUNT_MANIPULATION_ATTEMPT", { coupons: data.coupons || [], expectedDiscount: couponResult.discount, submittedDiscount }, user.id, null, sessionId);
  }
  if ((data.coupons || []).length > 1) {
    await record("COUPON_STACK_ATTEMPT", { coupons: data.coupons, accepted: couponResult.accepted, rejected: couponResult.rejected }, user.id, null, sessionId);
  }
  for (const rejected of couponResult.rejected) {
    if (/limit|expired/i.test(rejected.reason)) await record("COUPON_LIMIT_EXCEEDED", rejected, user.id, null, sessionId);
  }

  const discount = couponResult.discount;
  const delivery = couponResult.freeDelivery ? 0 : 350;
  const codFee = data.paymentMethod === "COD" && !data.codPromotion ? 150 : 0;
  const total = subtotal - discount + delivery + codFee;
  const orderNumber = `CK-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;

  const rulelockOn = await isRulelockEnabled();
  let rulelockResult = { decision: "accept", reason: "RuleLock disabled" };
  if (rulelockOn) {
    const { pastOrders, pastRefusals } = data.paymentMethod === "COD"
      ? await codHistory(user.id)
      : { pastOrders: 0, pastRefusals: 0 };

    rulelockResult = await reviewWithRuleLock({
      orderId: orderNumber,
      sessionId,
      accountId: String(user.id),
      coupons: couponResult.accepted.map((coupon) => coupon.code),
      discount,
      items: verifiedItems,
      subtotal,
      total,
      paymentMethod: data.paymentMethod,
      accountVerified: true,
      pastOrders,
      pastRefusals,
    });

    if (rulelockResult.decision === "reject") {
      await record("RULELOCK_REJECTED", { reason: rulelockResult.reason }, user.id, null, sessionId);
      return res.status(403).json({ success: false, error: { code: "RULELOCK_REJECTED", message: rulelockResult.reason || "This order could not be placed." } });
    }
  }

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      user_id: user.id,
      items: verifiedItems,
      address: data.address,
      payment_method: data.paymentMethod,
      payment_status: data.paymentMethod === "CARD" ? "PAID" : "PENDING",
      status: rulelockResult.decision === "hold" ? "PENDING_REVIEW" : "PENDING",
      subtotal,
      discount,
      delivery_fee: delivery + codFee,
      total,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });

  await recordUsage({ result: couponResult, userId: user.id, orderId: order.id, supabase });
  await record("ORDER_CREATED", { total, paymentMethod: order.payment_method, coupons: data.coupons, acceptedCoupons: couponResult.accepted, rejectedCoupons: couponResult.rejected }, user.id, order.id, sessionId);
  if (rulelockOn) await record("RULELOCK_REVIEW", { decision: rulelockResult.decision, reason: rulelockResult.reason }, user.id, order.id, sessionId);

  res.status(201).json({ success: true, data: { id: order.id, orderNumber: order.order_number, total, status: order.status } });
});

app.post("/custom-cakes", upload.single("image"), async (req, res) => {
  const { user } = await currentUser(req);
  const data = req.body || {};
  if (!data.size || !data.flavour || !data.message) {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Size, flavour, and cake message are required." } });
  }
  let imageName = null;
  if (req.file) {
    try {
      const stored = await storeImage({ upload: req.file, bucket: CUSTOM_CAKE_BUCKET, prefix: "custom", supabase });
      imageName = stored.filename;
    } catch (err) {
      return res.status(400).json({ success: false, error: { code: "INVALID_IMAGE", message: err.message } });
    }
  }
  const { data: row, error } = await supabase
    .from("custom_cake_requests")
    .insert({ user_id: user ? user.id : null, size: data.size, flavour: data.flavour, message: data.message, instructions: data.instructions || "", image_name: imageName })
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  await record("CUSTOM_CAKE_CREATED", { size: row.size, flavour: row.flavour, hasImage: !!imageName }, row.user_id, null, req.headers["x-session-id"] || null);
  res.status(201).json({ success: true, data: { id: row.id, status: row.status } });
});

app.get("/orders", async (req, res) => {
  const { user } = await currentUser(req);
  if (!user) return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Please sign in to view orders." } });
  const { data, error } = await supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  res.json({
    success: true,
    data: (data || []).map((row) => ({ id: row.id, orderNumber: row.order_number, items: row.items, total: Number(row.total), status: row.status, paymentMethod: row.payment_method, createdAt: row.created_at })),
  });
});

app.get("/admin/summary", async (req, res) => {
  const { user } = await currentUser(req);
  if (!user || !user.is_admin) return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Administrator access required." } });
  const { data: orders } = await supabase.from("orders").select("total,status");
  const { count: events } = await supabase.from("transaction_events").select("id", { count: "exact", head: true });
  res.json({
    success: true,
    data: {
      orders: (orders || []).length,
      pending: (orders || []).filter((o) => o.status === "PENDING").length,
      revenue: (orders || []).reduce((sum, o) => sum + Number(o.total), 0),
      events: events || 0,
    },
  });
});

app.get("/admin/dashboard", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { data: allOrders } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
  const { data: customers } = await supabase.from("users").select("*").eq("is_admin", false).order("created_at", { ascending: false });
  const { data: coupons } = await supabase.from("coupons").select("*").order("created_at", { ascending: false });
  const { data: events } = await supabase.from("transaction_events").select("*").order("created_at", { ascending: false }).limit(20);
  const { data: products } = await supabase.from("products").select("*").order("id");
  const { data: rulelockEvent } = await supabase.from("transaction_events").select("metadata").eq("event_type", "RULELOCK_SETTING_CHANGED").order("created_at", { ascending: false }).limit(1).maybeSingle();

  const usernameById = new Map((customers || []).map((c) => [c.id, c.username]));
  const orderDicts = (allOrders || []).map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    customer: usernameById.get(row.user_id) || null,
    total: Number(row.total),
    status: row.status,
    paymentMethod: row.payment_method,
    createdAt: row.created_at,
  }));

  const spendingByUser = new Map();
  for (const order of allOrders || []) {
    spendingByUser.set(order.user_id, (spendingByUser.get(order.user_id) || 0) + Number(order.total));
  }
  const customerDicts = (customers || []).map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    orders: (allOrders || []).filter((o) => o.user_id === row.id).length,
    spending: spendingByUser.get(row.id) || 0,
    createdAt: row.created_at,
  }));

  const couponDicts = (coupons || []).map((row) => ({ id: row.id, code: row.code, description: row.description, discountType: row.discount_type, discountValue: Number(row.discount_value), active: row.active }));
  const eventDicts = (events || []).map((row) => ({ id: row.id, eventId: row.event_id, eventType: row.event_type, orderId: row.order_id, createdAt: row.created_at }));

  res.json({
    success: true,
    data: {
      orders: (allOrders || []).length,
      pending: (allOrders || []).filter((o) => o.status === "PENDING").length,
      preparing: (allOrders || []).filter((o) => o.status === "PREPARING").length,
      completed: (allOrders || []).filter((o) => o.status === "COMPLETED").length,
      customerCount: (customers || []).length,
      productCount: (products || []).length,
      couponCount: (coupons || []).filter((c) => c.active).length,
      revenue: (allOrders || []).reduce((sum, o) => sum + Number(o.total), 0),
      recentOrders: orderDicts.slice(0, 6),
      allOrders: orderDicts,
      customers: customerDicts,
      products: (products || []).map(productAsDict),
      coupons: couponDicts,
      events: eventDicts,
      rulelockEnabled: rulelockEvent?.metadata?.enabled === true,
    },
  });
});

app.patch("/admin/rulelock", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const enabled = req.body?.enabled === true;
  await record("RULELOCK_SETTING_CHANGED", { enabled }, admin.id, null, req.headers["x-session-id"] || null);
  res.json({ success: true, data: { enabled } });
});

app.post("/admin/products", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const data = req.body || {};
  if (!data.name || !data.slug || !data.description || !data.category) {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Name, slug, description, and category are required." } });
  }
  const { data: existing } = await supabase.from("products").select("id").eq("slug", data.slug).maybeSingle();
  if (existing) return res.status(409).json({ success: false, error: { code: "SLUG_EXISTS", message: "That product slug is already used." } });
  const basePrice = Number(data.basePrice || 0);
  const { data: row, error } = await supabase
    .from("products")
    .insert({
      name: data.name,
      slug: data.slug,
      description: data.description,
      category: data.category,
      base_price: basePrice,
      image: data.image || "",
      flavours: data.flavours || ["Vanilla"],
      sizes: data.sizes || { "1 kg": basePrice },
      active: data.active === undefined ? true : !!data.active,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  await record("ADMIN_PRODUCT_CREATED", { productId: row.id, name: row.name }, admin.id, null, req.headers["x-session-id"] || null);
  res.status(201).json({ success: true, data: productAsDict(row) });
});

app.put("/admin/products/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const productId = Number(req.params.id);
  const { data: row } = await supabase.from("products").select("*").eq("id", productId).maybeSingle();
  if (!row) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found." } });
  const data = req.body || {};
  if (data.slug && data.slug !== row.slug) {
    const { data: existing } = await supabase.from("products").select("id").eq("slug", data.slug).neq("id", productId).maybeSingle();
    if (existing) return res.status(409).json({ success: false, error: { code: "SLUG_EXISTS", message: "That product slug is already used." } });
  }
  const updates = {};
  for (const [key, col] of [["name", "name"], ["slug", "slug"], ["description", "description"], ["category", "category"], ["image", "image"], ["flavours", "flavours"], ["sizes", "sizes"], ["active", "active"]]) {
    if (key in data) updates[col] = data[key];
  }
  if ("basePrice" in data) updates.base_price = Number(data.basePrice);
  const { data: updated, error } = await supabase.from("products").update(updates).eq("id", productId).select().single();
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  await record("ADMIN_PRODUCT_UPDATED", { productId }, admin.id, null, req.headers["x-session-id"] || null);
  res.json({ success: true, data: productAsDict(updated) });
});

app.post("/admin/products/:id/image", upload.single("image"), async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const productId = Number(req.params.id);
  const { data: row } = await supabase.from("products").select("*").eq("id", productId).maybeSingle();
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const extension = String(req.file?.originalname || "").toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/)?.[1];
  const validImage = req.file && (allowedTypes.has(req.file.mimetype) || Boolean(extension));
  if (!row || !validImage) {
    return res.status(400).json({ success: false, error: { code: "INVALID_IMAGE", message: "Choose a JPG, PNG, WEBP, or GIF image." } });
  }
  if (req.file.size > 3 * 1024 * 1024) return res.status(400).json({ success: false, error: { code: "IMAGE_TOO_LARGE", message: "Choose an image smaller than 3 MB." } });
  const imageDataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  const { data: updated, error } = await supabase.from("products").update({ image: imageDataUrl }).eq("id", productId).select().single();
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  await record("ADMIN_PRODUCT_IMAGE_CHANGED", { productId, storage: "database", bytes: req.file.size, contentType: req.file.mimetype }, admin.id, null, req.headers["x-session-id"] || null);
  res.json({ success: true, data: productAsDict(updated) });
});

app.delete("/admin/products/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const productId = Number(req.params.id);
  const { data: row, error: lookupError } = await supabase.from("products").select("id,image").eq("id", productId).maybeSingle();
  if (lookupError) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: lookupError.message } });
  if (!row) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found." } });
  try {
    await removeImagesByPrefix({ bucket: PRODUCT_BUCKET, prefix: `product_${productId}_`, supabase });
  } catch (err) {
    console.error("product image cleanup failed:", err.message);
  }
  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  await record("ADMIN_PRODUCT_DELETED", { productId }, admin.id, null, req.headers["x-session-id"] || null);
  res.json({ success: true });
});

app.patch("/admin/orders/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const orderId = Number(req.params.id);
  const status = (req.body || {}).status;
  const allowed = new Set(["PENDING", "PENDING_REVIEW", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED", "REFUNDED"]);
  if (!allowed.has(status)) return res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: "Order or status is invalid." } });
  const { data: updated, error } = await supabase.from("orders").update({ status }).eq("id", orderId).select().maybeSingle();
  if (error || !updated) return res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: "Order or status is invalid." } });
  await record("ORDER_STATUS_CHANGED", { status }, admin.id, orderId, req.headers["x-session-id"] || null);
  res.json({ success: true, data: { id: updated.id, status: updated.status } });
});

app.post("/admin/coupons", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const data = req.body || {};
  const code = String(data.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Coupon code is required." } });
  const { data: row, error } = await supabase
    .from("coupons")
    .insert({
      code,
      description: data.description || "",
      discount_type: data.discountType || "PERCENTAGE",
      discount_value: Number(data.discountValue || 0),
      minimum_order: Number(data.minimumOrder || 0),
      max_discount: data.maxDiscount != null ? Number(data.maxDiscount) : null,
      usage_limit: data.usageLimit ?? null,
      per_user_limit: data.perUserLimit ?? null,
      expires_at: data.expiresAt || null,
      can_stack: !!data.canStack,
      first_order_only: !!data.firstOrderOnly,
      free_delivery: !!data.freeDelivery,
      cod_applicable: data.codApplicable === undefined ? true : !!data.codApplicable,
      active: data.active === undefined ? true : !!data.active,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  await record("ADMIN_COUPON_CREATED", { couponId: row.id, code: row.code }, admin.id, null, req.headers["x-session-id"] || null);
  res.status(201).json({ success: true, data: { id: row.id, code: row.code } });
});

app.put("/admin/coupons/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const couponId = Number(req.params.id);
  const { data: row } = await supabase.from("coupons").select("*").eq("id", couponId).maybeSingle();
  if (!row) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Coupon not found." } });
  const data = req.body || {};
  const updates = {};
  for (const [key, col] of [["description", "description"], ["discountType", "discount_type"], ["active", "active"], ["canStack", "can_stack"], ["firstOrderOnly", "first_order_only"], ["codApplicable", "cod_applicable"], ["freeDelivery", "free_delivery"]]) {
    if (key in data) updates[col] = data[key];
  }
  if ("code" in data) updates.code = String(data.code).toUpperCase();
  if ("discountValue" in data) updates.discount_value = Number(data.discountValue);
  if ("minimumOrder" in data) updates.minimum_order = Number(data.minimumOrder);
  if ("maxDiscount" in data) updates.max_discount = data.maxDiscount != null ? Number(data.maxDiscount) : null;
  if ("usageLimit" in data) updates.usage_limit = data.usageLimit;
  if ("perUserLimit" in data) updates.per_user_limit = data.perUserLimit;
  if ("expiresAt" in data) updates.expires_at = data.expiresAt;
  const { error } = await supabase.from("coupons").update(updates).eq("id", couponId);
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  await record("ADMIN_COUPON_UPDATED", { couponId }, admin.id, null, req.headers["x-session-id"] || null);
  res.json({ success: true, data: { id: couponId } });
});

app.delete("/admin/coupons/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const couponId = Number(req.params.id);
  const { error } = await supabase.from("coupons").update({ active: false }).eq("id", couponId);
  if (error) return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message } });
  await record("ADMIN_COUPON_DEACTIVATED", { couponId }, admin.id, null, req.headers["x-session-id"] || null);
  res.json({ success: true });
});

app.use((_req, res) => res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found." } }));

module.exports.app = app;
module.exports.handler = serverless(app, { binary: ["multipart/form-data"] });
