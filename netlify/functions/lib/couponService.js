const PAYMENT_RULES = {
  CAKE50: new Set(["CARD"]),
  CAKE30: new Set(["COD"]),
  SAVE500: new Set(["COD"]),
  FIRSTCAKE: new Set(["CARD"]),
  FREEDESSERT: new Set(["COD"]),
};
const PERCENTAGE_CODES = new Set(["CAKE10", "CAKE20", "CAKE30", "CAKE50"]);

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// codes: string[], subtotal: number, user: {id}|null, paymentMethod: string
// coupons: array of coupon rows already fetched by code, usageCounts: {couponId: {total, perUser}}
async function validateCoupons({ codes, subtotal, user, paymentMethod, securityMode = "normal", supabase }) {
  const result = { accepted: [], rejected: [], discount: 0, freeDelivery: false };
  const normalized = (codes || []).map((code) => String(code).trim().toUpperCase()).filter(Boolean);
  const seen = new Set();

  for (const code of normalized) {
    if (seen.has(code)) {
      result.rejected.push({ code, reason: "Coupon repeated in request" });
      continue;
    }
    seen.add(code);

    const { data: coupon } = await supabase.from("coupons").select("*").eq("code", code).maybeSingle();
    if (!coupon || !coupon.active) {
      result.rejected.push({ code, reason: "Coupon is inactive or unknown" });
      continue;
    }
    const now = new Date();
    if (coupon.expires_at && new Date(coupon.expires_at) < now) {
      result.rejected.push({ code, reason: "Coupon expired" });
      continue;
    }
    if (subtotal < Number(coupon.minimum_order)) {
      result.rejected.push({ code, reason: "Minimum order value not met" });
      continue;
    }
    if (paymentMethod === "COD" && !coupon.cod_applicable) {
      result.rejected.push({ code, reason: "Coupon is not valid for COD" });
      continue;
    }
    if (PAYMENT_RULES[code] && !PAYMENT_RULES[code].has(paymentMethod)) {
      result.rejected.push({ code, reason: `Coupon is for ${[...PAYMENT_RULES[code]][0]} only` });
      continue;
    }
    if (PERCENTAGE_CODES.has(code) && result.accepted.some((item) => PERCENTAGE_CODES.has(item.code))) {
      result.rejected.push({ code, reason: "Only one percentage coupon can be used" });
      continue;
    }
    if (coupon.usage_limit) {
      const { count } = await supabase.from("coupon_usages").select("id", { count: "exact", head: true }).eq("coupon_id", coupon.id);
      if ((count || 0) >= coupon.usage_limit) {
        result.rejected.push({ code, reason: "Coupon usage limit reached" });
        continue;
      }
    }
    if (user && coupon.per_user_limit) {
      const { count } = await supabase.from("coupon_usages").select("id", { count: "exact", head: true }).eq("coupon_id", coupon.id).eq("user_id", user.id);
      if ((count || 0) >= coupon.per_user_limit) {
        result.rejected.push({ code, reason: "Your coupon usage limit was reached" });
        continue;
      }
    }
    if (result.accepted.length && (!coupon.can_stack || result.accepted.some((item) => !item.canStack))) {
      result.rejected.push({ code, reason: "Coupon cannot be stacked" });
      continue;
    }

    let value;
    if (coupon.discount_type === "PERCENTAGE") {
      value = (subtotal * Number(coupon.discount_value)) / 100;
      if (coupon.max_discount != null) value = Math.min(value, Number(coupon.max_discount));
    } else if (coupon.discount_type === "FIXED") {
      value = Number(coupon.discount_value);
    } else {
      value = 0;
      result.freeDelivery = true;
    }
    result.discount = Math.min(subtotal, result.discount + value);
    result.accepted.push({ code, discount: round2(value), canStack: coupon.can_stack });
  }

  if (securityMode === "research" && normalized.length > 1) {
    result.accepted = normalized.map((code) => ({ code, discount: 0, canStack: true }));
    result.rejected = [];
  }
  result.discount = round2(result.discount);
  return result;
}

async function recordUsage({ result, userId, orderId, supabase }) {
  for (const accepted of result.accepted) {
    const { data: coupon } = await supabase.from("coupons").select("id").eq("code", accepted.code).maybeSingle();
    if (coupon) {
      await supabase.from("coupon_usages").insert({ coupon_id: coupon.id, user_id: userId, order_id: orderId });
    }
  }
}

module.exports = { validateCoupons, recordUsage };
