// Cakely-side transport only; RuleLock owns all intelligence.
// Disabled by default (RULELOCK_ENABLED=false) so Cakely works standalone.
// Flip RULELOCK_ENABLED=true and set RULELOCK_API_URL / RULELOCK_API_KEY once
// the RuleLock AI service exists, without touching any other Cakely code.
const { randomUUID } = require("crypto");

function fallback(reason) {
  const failMode = (process.env.RULELOCK_FAIL_MODE || "OPEN").toUpperCase();
  return { decision: failMode === "OPEN" ? "ALLOW" : "HOLD", reason, risk_score: 0, violations: [], event_id: randomUUID() };
}

async function sendTransactionEvent(payload) {
  if ((process.env.RULELOCK_ENABLED || "false").toLowerCase() !== "true") {
    return { decision: "ALLOW", reason: "RuleLock disabled", risk_score: 0, violations: [] };
  }
  const url = (process.env.RULELOCK_API_URL || "").replace(/\/$/, "");
  if (!url) return fallback("RuleLock URL is not configured");

  const timeoutMs = Number(process.env.RULELOCK_TIMEOUT || "5") * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${url}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": process.env.RULELOCK_API_KEY || "" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RuleLock responded ${response.status}`);
    const data = await response.json();
    return {
      decision: data.decision || "HOLD",
      reason: data.reason || "",
      risk_score: data.risk_score || 0,
      violations: data.violations || [],
      response_ms: Date.now() - started,
    };
  } catch {
    return fallback("RuleLock unavailable");
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendTransactionEvent };
