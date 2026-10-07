// Manual live check using the production adapter. No Mendocean database access.
// Run: deno run --config supabase/functions/deno.json --allow-net=127.0.0.1:5184,api.boathouseconnect.com --allow-env scripts/bhc-password-contract.ts
import {
  bhcGet,
  generateBHCToken,
  list,
} from "../supabase/functions/_shared/bhc-client.ts";
import { mendotaClub, tokenMetadata } from "../shared/bhcConnection.ts";

const port = 5184;
const origin = `http://127.0.0.1:${port}`;
const nonce = Deno.env.get("BHC_CONTRACT_NONCE") || crypto.randomUUID();
const path = `/verify-${nonce}`;
const providers = { fetch, now: Date.now, push: async () => {} };
let busy = false;
let attempts = 0;
let complete = false;
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
};
const page = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verify BHC password connection</title>
<style>body{font:16px system-ui;max-width:480px;margin:50px auto;padding:20px;color:#193d37}label{display:block;margin:20px 0}input{display:block;box-sizing:border-box;width:100%;padding:12px;margin-top:8px;font:inherit}button{padding:12px;font:inherit;background:#193d37;color:white;border:0;border-radius:6px}button:disabled{opacity:.5}pre{white-space:pre-wrap;font:inherit}small{display:block;line-height:1.5}</style>
<h1>Verify BHC password connection</h1>
<p>Use your Boathouse Connect login. Your Mendocean connection stays as it is.</p>
<small>This sends your credentials to BHC through this local test. They are not saved or printed. The test creates one token and deletes it only if BHC confirms it was newly created for this test. It does not change practices or attendance.</small>
<form id="form" autocomplete="off">
<label>BHC email<input id="email" type="email" required maxlength="254" autocomplete="off"></label>
<label>BHC password<input id="password" type="password" required maxlength="1024" autocomplete="off"></label>
<button id="submit">Verify login and clean up test token</button>
</form><pre id="result" role="status"></pre>
<script nonce="${nonce}">
const form=document.getElementById('form'),button=document.getElementById('submit'),result=document.getElementById('result');
form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;result.textContent='Checking BHC…';let body=JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value});form.reset();try{const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json','X-Contract-Nonce':'${nonce}'},body});body='';const data=await response.json();result.textContent=data.summary;if(data.complete)form.hidden=true;else button.disabled=false;}catch{body='';result.textContent='The local check could not finish. Check the test output before trying again.';}});
</script></html>`;

const server = Deno.serve({ hostname: "127.0.0.1", port }, async (request) => {
  const url = new URL(request.url);
  if (url.origin !== origin || url.pathname !== path) {
    return new Response("Not found", { status: 404, headers });
  }
  if (request.method === "GET") {
    return new Response(page, {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (
    request.method !== "POST" || request.headers.get("Origin") !== origin ||
    request.headers.get("X-Contract-Nonce") !== nonce ||
    request.headers.get("Content-Type") !== "application/json"
  ) return new Response("Request refused", { status: 403, headers });
  const reply = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  if (busy || complete || attempts >= 3) {
    return reply({
      summary:
        "This test is running, finished, or has reached its attempt limit.",
      complete,
    }, 409);
  }
  busy = true;
  let token: string | undefined;
  let newlyCreated = false;
  let result: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.length > 4096) throw new Error();
    const input = JSON.parse(text);
    if (
      typeof input.email !== "string" || !input.email.trim() ||
      input.email.length > 254 || typeof input.password !== "string" ||
      !input.password || input.password.length > 1024
    ) throw new Error();
    attempts++;
    const started = Math.floor(Date.now() / 1000);
    token = await generateBHCToken(
      input.email.trim(),
      input.password,
      providers,
    );
    input.password = "";
    input.email = "";
    result = { exchange_verified: true, stage: "token_metadata" };
    const raw = await bhcGet("authenticate/checkApiKey", token, {}, providers);
    const metadata = tokenMetadata(raw, Date.now());
    newlyCreated = Number.isSafeInteger(Number(raw.token_id)) &&
      Number(raw.token_id) > 0 &&
      Number(raw.created_at) >= started &&
      Number(raw.created_at) <= Math.floor(Date.now() / 1000);
    result.token_verified = !!metadata && !metadata.expired;
    result.expires_at = metadata?.expires_at || null;
    if (!metadata || metadata.expired || !metadata.expires_at) {
      throw new Error();
    }
    const club = mendotaClub(
      list(await bhcGet("users/getAllWhitelabels", token, {}, providers)),
      2362,
    );
    result.stage = "membership";
    result.mendota_verified = !!club;
    if (!club) throw new Error();
    const expiresInDays = Math.round(
      (Date.parse(metadata.expires_at) - Date.now()) / 86400000,
    );
    result.stage = "expiry_duration";
    result.expires_in_days = expiresInDays;
    // The live API returned 365 days despite its documentation saying six months.
    // Validate its actual timestamp, never a hardcoded token lifetime.
    result = {
      exchange_verified: true,
      token_verified: true,
      mendota_verified: true,
      expires_at: metadata.expires_at,
      expires_in_days: expiresInDays,
      contract_verified: true,
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? error.code
      : "contract_unconfirmed";
    result = { ...result, contract_verified: false, code };
  } finally {
    if (token && newlyCreated) {
      try {
        const response = await fetch(
          "https://api.boathouseconnect.com/authenticate/deleteToken",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(10000),
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ tokenDestroy: token }),
          },
        );
        const raw = await response.json();
        if (
          !response.ok || raw.Status !== "Token destroyed" ||
          raw.OldToken !== token
        ) throw new Error();
        const rejected = tokenMetadata(
          await bhcGet("authenticate/checkApiKey", token, {}, providers),
          Date.now(),
        );
        if (rejected !== null) throw new Error();
        result.test_token_deleted = true;
        result.revoked_token_verified = true;
      } catch {
        result.cleanup_unconfirmed = true;
      }
    } else if (token) result.token_creation_unconfirmed = true;
    token = undefined;
    busy = false;
  }
  complete = result.exchange_verified === true ||
    result.cleanup_unconfirmed === true ||
    result.token_creation_unconfirmed === true;
  console.log(JSON.stringify({ test: "bhc_password_contract", ...result }));
  const summary = result.contract_verified
    ? `BHC login, Mendota membership and token expiry verified (${result.expires_in_days} days). ${
      result.test_token_deleted
        ? "The test token was deleted; rejection after deletion was verified."
        : "Token cleanup needs review; no existing token was deleted."
    } Your Mendocean connection was not changed.`
    : result.code === "bhc_credentials"
    ? "BHC did not recognize that email and password. Check them and try again."
    : `The provider contract needs review. Your Mendocean connection was not changed.\n${
      JSON.stringify(result, null, 2)
    }`;
  return reply({ summary, complete });
});
console.log(`BHC_CONTRACT_URL=${origin}${path}`);
setTimeout(() => void server.shutdown(), 20 * 60000);
await server.finished;
