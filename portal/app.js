/* FairSpec UI */
(function () {
  const M = window.FairModel;
  const L = window.I18N;
  const { t, tp } = L;
  const rows = M.rows;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const round10 = (n) => Math.round(n / 10) * 10;
  const ST_LABEL = { ssd: "SSD", hdd: "HDD", emmc: "eMMC" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const gpuShort = (g) => String(g).replace(/NVIDIA GeForce |NVIDIA |AMD |Intel |Qualcomm Snapdragon X Elite |^Apple /g, "").replace(/\s*\((Laptop)[^)]*\)/, "").replace(/\s*\((\d+)-core GPU\)/, " · $1-core GPU").trim();
  const storageLabel = (gb) => (gb >= 1000 ? gb / 1000 + " TB" : gb + " GB");
  const verdictLabel = (v) => t("v_" + v.cls);

  // ---------- storage (demo persistence) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  // ---------- language ----------
  L.lang = store.get("fs_lang", null) || L.detect();

  // ---------- markets, tax & currency ----------
  // The model prices everything in US dollars before sales tax. Each market converts that into
  // its own price level using ratios measured from real store prices (reference.js), then adds VAT.
  // VAT rates as of 2026 — check them yearly.
  // EUR (Germany, incl. 19% VAT) per USD, measured from configurations sold in both official stores (model.js).
  const EUR_EX_VAT = M.eurPerUsdGermany / 1.19;
  const EU = (vat) => ({ cur: "EUR", vat, factor: EUR_EX_VAT * (1 + vat) });
  const REGIONS = {
    US: { cur: "USD", vat: 0, factor: 1 },
    GB: { cur: "GBP", vat: 0.2, factor: 1 }, // UK stores usually show the US-dollar number in £ incl. VAT (not yet verified per model)
    DE: EU(0.19), FR: EU(0.2), ES: EU(0.21), IT: EU(0.22), NL: EU(0.21), AT: EU(0.2),
    BE: EU(0.21), IE: EU(0.23), PT: EU(0.23), FI: EU(0.255),
  };
  const TZ_REGION = { London: "GB", Berlin: "DE", Paris: "FR", Rome: "IT", Madrid: "ES", Amsterdam: "NL", Vienna: "AT", Brussels: "BE", Dublin: "IE", Lisbon: "PT", Helsinki: "FI" };
  function guessRegion() {
    let tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
    if (!tz.startsWith("Europe/")) return "US";
    return TZ_REGION[tz.split("/")[1]] || "DE";
  }
  let regionCode = store.get("fs_region", null);
  if (!REGIONS[regionCode]) regionCode = guessRegion();
  let curPref = store.get("fs_currency", "auto");
  const CURRENCIES = ["USD", "EUR", "GBP"];
  const region = () => REGIONS[regionCode];
  const displayCur = () => (curPref === "auto" ? region().cur : curPref);
  const countryName = (code = regionCode) => { try { return new Intl.DisplayNames([L.locale()], { type: "region" }).of(code); } catch { return code; } };

  // Exchange rates per 1 USD (European Central Bank via Frankfurter, cached 12 h; fallback if offline).
  // Only used when someone views prices in a currency other than their market's.
  let FX = Object.assign({ USD: 1, EUR: 0.86, GBP: 0.75 }, (store.get("fs_fx", {}) || {}).rates);
  async function refreshFx() {
    const cached = store.get("fs_fx", null);
    if (cached && Date.now() - cached.at < 12 * 3600e3) return;
    const urls = ["https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP", "https://api.frankfurter.app/latest?from=USD&to=EUR,GBP"];
    for (const url of urls) {
      try {
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(url, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        clearTimeout(timer);
        if (!res.ok) continue;
        const j = await res.json();
        const r = j && j.rates;
        if (r && r.EUR > 0.3 && r.EUR < 3 && r.GBP > 0.3 && r.GBP < 3) {
          FX = { USD: 1, EUR: +r.EUR, GBP: +r.GBP };
          store.set("fs_fx", { at: Date.now(), rates: FX });
          if (displayCur() !== region().cur) renderAll();
          return;
        }
      } catch {}
    }
  }

  const fmt = (n, cur = displayCur(), digits = 0) =>
    new Intl.NumberFormat(L.locale(), { style: "currency", currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(digits ? n : Math.round(n));
  const curSymbol = (cur = displayCur()) => (new Intl.NumberFormat(L.locale(), { style: "currency", currency: cur }).formatToParts(0).find((p) => p.type === "currency") || {}).value || cur;
  // model USD → amount in the market's currency → shown in the chosen currency
  const toDisp = (usd) => (usd * region().factor / FX[region().cur]) * FX[displayCur()];
  const toUsd = (disp) => (disp / FX[displayCur()]) * FX[region().cur] / region().factor;
  const money = (usd) => { const v = toDisp(usd); return fmt(displayCur() === "USD" && regionCode === "US" ? v : v < 100 ? v : round10(v)); };
  const mask = () => fmt(8888).replace(/\d/g, "•");
  // Price of a catalog row in the display currency: the real German store price for euro markets when we
  // have it (re-scaled to that country's VAT), otherwise the US price converted with the measured ratio.
  const dispPrice = (r) => {
    const reg = region();
    if (reg.cur === "EUR" && r.de) return (r.de / 1.19) * (1 + reg.vat) / FX.EUR * FX[displayCur()];
    return toDisp(r.price);
  };
  // "≈" when the shown price is converted from another market's store rather than read from the local one
  const rowExact = (r) => (region().cur === "EUR" ? !!r.de : region().cur === "USD" ? !!r.us : false) && displayCur() === region().cur;
  const rowMoney = (r) => (rowExact(r) ? "" : "≈ ") + fmt(dispPrice(r));
  const screenTxt = (r) => `${r.inches}"` + (r.xr && r.yr ? ` · ${r.xr}×${r.yr}` : "");
  const taxNote = () => (region().vat ? t("tax_incl", { p: +(region().vat * 100).toFixed(1) }) : t("tax_before"));

  // Used-market retention vs. the price of the same specs bought new today (good condition).
  // "Same specs new today" is priced from current models, so an old chip still looks close to a new one —
  // the curve has to carry the whole generation gap.
  // Apple: calibrated to Swappa average sale prices (swappa.com/blog/when-will-macbook-prices-drop, 25 Sep 2026):
  //   MacBook Air 13 256GB — M1 (5+ yrs) $369, M2 (3–4 yrs) $626, M3 (2–3 yrs) $726.
  // Others: Windows laptops lose value faster than Macs; not yet calibrated per model.
  const RETENTION = {
    apple: [0.85, 0.76, 0.70, 0.66, 0.56, 0.41],
    other: [0.75, 0.62, 0.52, 0.43, 0.35, 0.27],
  };

  // ---------- backend (Supabase) ----------
  // Accounts, listings and messages live in Supabase; Row Level Security (supabase/schema.sql) decides
  // what each visitor may read or write. Guests stay local: no account, nothing stored on the server.
  const CFG = window.FAIRSPEC_CONFIG || {};
  const sb = window.supabase && CFG.supabaseUrl ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;

  // session: null (signed out) · { guest: true } · { id, email, name }
  let session = store.get("fs_guest", false) ? { guest: true, name: "Guest" } : null;
  async function loadSession(authSession) {
    const u = authSession && authSession.user;
    if (!u) { if (session && !session.guest) session = null; return; }
    let name = (u.user_metadata && u.user_metadata.display_name) || u.email.split("@")[0];
    try {
      const { data } = await sb.from("profiles").select("display_name").eq("id", u.id).maybeSingle();
      if (data && data.display_name) name = data.display_name;
    } catch {}
    session = { id: u.id, email: u.email, name };
    store.del("fs_guest");
  }
  const authError = (err) => {
    const m = String((err && (err.message || err.code)) || "");
    if (/invalid login/i.test(m)) return t("err_invalid");
    if (/not confirmed/i.test(m)) return t("err_unconfirmed");
    if (/already registered|already exists/i.test(m)) return t("err_exists");
    if (/listing_limit/.test(m)) return t("listing_limit");
    if (/message_limit/.test(m)) return t("message_limit");
    if (/fetch|network/i.test(m)) return t("err_offline");
    if (/password/i.test(m) && /6|short|weak/i.test(m)) return t("ph_pass");
    return t("err_generic");
  };

  // Passes stay demo-only until real payments exist; they are keyed by the signed-in email.
  const plansFor = () => (session && !session.guest ? store.get("fs_plans", {})[session.email] || {} : {});
  const hasAccess = (kind) => { const p = plansFor(); return !!(p.pro || p[kind]); };
  const sessionName = () => (session.guest ? t("guest_name") : session.name);

  // ---------- toast ----------
  let toastT;
  function toast(msg) {
    const el = $("#toast"); el.textContent = msg; el.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // ---------- routing ----------
  const VIEWS = ["home", "sell", "buy", "ask", "you"];
  function route() {
    const h = (location.hash || "#home").slice(1);
    const view = h === "pricing" ? "you" : VIEWS.includes(h) ? h : "home";
    $$(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
    $$(".dock a").forEach((a) => a.classList.toggle("on", a.dataset.link === view));
    document.body.dataset.view = view;
    if (h === "pricing") requestAnimationFrame(() => $("#pricing").scrollIntoView({ behavior: "smooth" }));
    else window.scrollTo({ top: 0 });
    if (view === "buy") renderBuy();
    if (view === "you") renderYou();
    if (view === "ask" && window.FairAssist) window.FairAssist.onShow();
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("scroll", () => $("#nav").classList.toggle("scrolled", scrollY > 20), { passive: true });

  const brands = [...new Set(rows.map((r) => r.brand))].filter((b) => b !== "Other");

  // ---------- hero laptop ----------
  const showcase = ["MacBook Air 13 (M5)", "OMEN Gaming 16 (16-ap0097nr)", "Surface Laptop 15 (8th Ed.)", "IdeaPad Slim 3x (15\" Snapdragon)", "Legion Pro 5i Gen 10 (16\") RTX 5060", "MacBook Pro 14 (M6)", "HP OmniBook X Flip 14 (14z-kc000)"]
    .map((m) => rows.find((r) => r.model === m)).filter(Boolean);
  while (showcase.length < 4) showcase.push(rows[showcase.length * 97]);
  let si = 0, heroRow = showcase[0];
  function paintScreen(r) {
    heroRow = r;
    $("#scrModel").textContent = r.model;
    $("#scrPrice").textContent = money(round10(r.fair));
    const bars = [r.cpuS, r.gpuS, Math.min(100, (Math.log2(r.ram) / 7) * 100), Math.min(100, (Math.log2(r.storage) / 13) * 100)];
    $$("#scrBars i").forEach((i, k) => i.style.setProperty("--w", Math.max(8, bars[k]) + "%"));
    const v = M.verdict(r.ratio);
    const b = $("#scrBadge"); b.textContent = verdictLabel(v); b.className = "scr-badge " + v.cls;
    $("#fc1").textContent = r.ram + " GB";
    $("#fc2").textContent = gpuShort(r.gpu).slice(0, 16);
    $("#fc3").textContent = storageLabel(r.storage);
    if (window.FairHero) window.FairHero.setScreen({
      model: r.model, price: money(round10(r.fair)), label: t("scr_label"),
      bars: bars.map((b) => b / 100), badge: verdictLabel(v), badgeCls: v.cls,
    });
  }
  window.addEventListener("fairhero:ready", () => paintScreen(heroRow));
  setInterval(() => { if (document.body.dataset.view === "home" && !document.hidden) paintScreen(showcase[++si % showcase.length]); }, 3600);

  // ---------- home: lifestyle shortcuts ----------
  $$("#lifeRow .life").forEach((b) => b.addEventListener("click", () => {
    location.hash = "#buy";
    const chip = $(`#bUse .chip[data-v="${b.dataset.use}"]`);
    if (chip) chip.click();
  }));

  // ---------- pricing ----------
  // Same number in every currency (EU/UK price includes VAT): $4.99 / €4.99 / £4.99.
  const PLANS = [
    { id: "free", amount: 0, per: "per_always" },
    { id: "seller", amount: 4.99, per: "per_once", hot: true },
    { id: "buyer", amount: 6.99, per: "per_once30", hot: true },
    { id: "pro", amount: 14.99, per: "per_month" },
  ];
  const planName = (id) => t("plan_" + id);
  const planPrice = (pl) => fmt(pl.amount, displayCur(), pl.amount ? 2 : 0);
  const planById = (id) => PLANS.find((p) => p.id === id);
  function renderPlans() {
    const p = plansFor();
    $("#priceNote").textContent = t("price_note", { cur: displayCur(), vat: displayCur() !== "USD" ? t("vat_incl") : "" });
    $("#plans").innerHTML = PLANS.map((pl) => {
      const owned = pl.id !== "free" && (p[pl.id] || (p.pro && pl.id !== "pro"));
      return `<article class="plan glass ${pl.hot ? "plan-hot" : ""} plan-${pl.id}">
        ${pl.hot ? `<span class="plan-flag">${esc(t("hot_once"))}</span>` : ""}
        <h3>${esc(planName(pl.id))}</h3><p class="plan-who">${esc(t("who_" + pl.id))}</p>
        <p class="plan-price">${planPrice(pl)}<small>${esc(t(pl.per))}</small></p>
        <ul>${t("f_" + pl.id).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        <button class="btn ${pl.hot ? "btn-ink" : "btn-outline"} btn-wide" data-plan="${pl.id}" ${owned ? "disabled" : ""}>${esc(owned ? t("active") : t("cta_" + pl.id))}</button>
      </article>`;
    }).join("");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-plan]");
    if (b && b.closest("#laptopModal")) closeModal($("#laptopModal"));
    if (!b) return;
    if (b.dataset.plan === "free") return requireSession(() => (location.hash = "#sell"));
    openCheckout(b.dataset.plan);
  });

  // ---------- modals ----------
  function openModal(id) { $(id).hidden = false; document.body.classList.add("locked"); }
  function closeModal(el) { el.hidden = true; if (!$$(".modal").some((m) => !m.hidden)) document.body.classList.remove("locked"); }
  $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) closeModal(m); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".modal").forEach((m) => !m.hidden && closeModal(m)); });

  // ---------- preferences: language, country, currency ----------
  function renderPrefs() {
    $("#prefsLabel").textContent = `${L.lang.toUpperCase()} · ${curSymbol()}`;
    $("#prefLang").innerHTML = L.LANGS.map(([code, label]) => `<button type="button" class="chip ${code === L.lang ? "on" : ""}" data-v="${code}" lang="${code}">${label}</button>`).join("");
    const codes = Object.keys(REGIONS).sort((a, b) => (a === "US" ? -1 : b === "US" ? 1 : countryName(a).localeCompare(countryName(b), L.locale())));
    $("#prefCountry").innerHTML = codes.map((c) => `<option value="${c}">${esc(countryName(c))} · ${REGIONS[c].cur}</option>`).join("");
    $("#prefCountry").value = regionCode;
    $("#prefCur").innerHTML = [["auto", t("cur_auto", { cur: region().cur })], ...CURRENCIES.map((c) => [c, `${c} ${curSymbol(c)}`])]
      .map(([v, label]) => `<button type="button" class="chip ${v === curPref ? "on" : ""}" data-v="${v}">${esc(label)}</button>`).join("");
  }
  $("#prefsBtn").addEventListener("click", () => { renderPrefs(); openModal("#prefsModal"); });
  $("#prefLang").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    L.lang = c.dataset.v; store.set("fs_lang", L.lang);
    renderAll(); renderPrefs();
  });
  $("#prefCountry").addEventListener("change", (e) => {
    regionCode = e.target.value; store.set("fs_region", regionCode);
    renderAll(); renderPrefs();
    toast(t("t_prefs", { country: countryName(), cur: displayCur() }));
  });
  $("#prefCur").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    curPref = c.dataset.v; store.set("fs_currency", curPref);
    renderAll(); renderPrefs();
    toast(t("t_prefs", { country: countryName(), cur: displayCur() }));
  });

  // ---------- auth ----------
  let authMode = "signin", afterAuth = null, authSubKey = ["auth_sub"];
  function setAuthMode(mode) {
    authMode = mode;
    const newPass = mode === "newpass";
    $$("#authModal .seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    $("#authModal .seg").hidden = newPass;
    $("#nameField").hidden = mode !== "signup";
    $("#emailField").hidden = newPass;
    $("#aEmail").required = !newPass;
    $("#forgotBtn").hidden = mode !== "signin";
    $("#authSubmit").textContent = newPass ? t("save_pass") : mode === "signup" ? t("signup") : t("sign_in");
    $("#aPass").autocomplete = mode === "signin" ? "current-password" : "new-password";
    $("#authErr").textContent = "";
    $("#authErr").classList.remove("ok");
  }
  const authMsg = (text, ok) => { $("#authErr").textContent = text; $("#authErr").classList.toggle("ok", !!ok); };
  $$("#authModal .seg button").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.mode)));

  function openAuth(cb, { sub, needEmail } = {}) {
    afterAuth = cb || null;
    authSubKey = sub || ["auth_sub"];
    $("#authSub").textContent = t(...authSubKey);
    $("#guestBtn").hidden = !!needEmail;
    $(".or").hidden = !!needEmail;
    setAuthMode(needEmail ? "signup" : "signin");
    openModal("#authModal");
    setTimeout(() => $("#aEmail").focus(), 50);
  }
  function requireSession(cb) { session ? cb() : openAuth(cb); }

  function finishAuth() {
    closeModal($("#authModal"));
    $("#authForm").reset();
    renderAll();
    toast(session.guest ? t("t_guest") : t("t_signed", { email: session.email }));
    const cb = afterAuth; afterAuth = null; cb && cb();
  }

  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return authMsg(t("err_offline"));
    const email = $("#aEmail").value.trim().toLowerCase();
    const pass = $("#aPass").value;
    const btn = $("#authSubmit"); btn.disabled = true;
    try {
      if (authMode === "newpass") {
        const { error } = await sb.auth.updateUser({ password: pass });
        if (error) return authMsg(authError(error));
        closeModal($("#authModal")); $("#authForm").reset(); toast(t("t_pass_saved"));
      } else if (authMode === "signup") {
        const display_name = $("#aName").value.trim().slice(0, 40) || email.split("@")[0];
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { display_name }, emailRedirectTo: location.origin + location.pathname } });
        if (error) return authMsg(authError(error));
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return authMsg(t("err_exists"));
        if (!data.session) { setAuthMode("signin"); $("#aEmail").value = email; return authMsg(t("check_email"), true); }
        await loadSession(data.session); finishAuth();
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) return authMsg(authError(error));
        await loadSession(data.session); finishAuth();
      }
    } catch (err) { authMsg(authError(err)); }
    finally { btn.disabled = false; }
  });
  $("#forgotBtn").addEventListener("click", async () => {
    const email = $("#aEmail").value.trim().toLowerCase();
    if (!email) return authMsg(t("need_email"));
    try { await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); } catch {}
    authMsg(t("reset_sent"), true); // same answer whether or not the account exists
  });
  $("#guestBtn").addEventListener("click", () => { session = { guest: true, name: "Guest" }; store.set("fs_guest", true); finishAuth(); });

  function renderAccount() {
    const el = $("#navAccount");
    const dd = $("#dockDot"); if (dd) dd.hidden = !(unread || pendingSales());
    if (!session) { el.innerHTML = `<button class="btn btn-nav" id="signInBtn">${esc(t("sign_in"))}</button>`; $("#signInBtn").onclick = () => openAuth(); return; }
    const p = plansFor();
    const plan = p.pro ? planName("pro") : [p.seller && planName("seller"), p.buyer && planName("buyer")].filter(Boolean).join(" + ") || planName("free");
    el.innerHTML = `<button class="acct" id="acctBtn" aria-expanded="false"><span class="avatar">${esc(sessionName()[0].toUpperCase())}</span><span class="acct-name">${esc(sessionName())}</span></button>
      <div class="acct-menu glass" id="acctMenu" hidden>
        <p class="acct-email">${session.guest ? esc(t("acct_guest")) : esc(session.email)}</p>
        <p class="acct-plan">${esc(t("acct_plan"))}: <b>${esc(plan)}</b></p>
        ${session.guest ? `<button class="btn btn-ink btn-wide" id="upgradeGuest">${esc(t("signup"))}</button>`
          : `<button class="btn btn-ink btn-wide" id="inboxBtn">${esc(t("messages"))}${unread ? ` <span class="count">${unread}</span>` : ""}</button>`}
        <button class="btn btn-outline btn-wide" id="signOut">${esc(t("sign_out"))}</button>
      </div>`;
    if (unread || pendingSales()) $("#acctBtn").insertAdjacentHTML("beforeend", `<span class="dot-unread" aria-hidden="true"></span>`);
    const menu = $("#acctMenu");
    $("#acctBtn").onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    $("#signOut").onclick = async () => {
      if (!session.guest && sb) { try { await sb.auth.signOut(); } catch {} }
      session = null; store.del("fs_guest"); unread = 0; inbox = []; orders = [];
      renderAll(); toast(t("t_signout"));
    };
    const ib = $("#inboxBtn");
    if (ib) ib.onclick = () => { menu.hidden = true; openInbox(); };
    const ug = $("#upgradeGuest");
    if (ug) ug.onclick = () => { menu.hidden = true; openAuth(null, { needEmail: true, sub: ["auth_sub_keep"] }); };
  }
  document.addEventListener("click", (e) => { const m = $("#acctMenu"); if (m && !e.target.closest("#navAccount")) m.hidden = true; });

  // ---------- checkout (demo) ----------
  let payOpenFor = null;
  function openCheckout(planId) {
    if (!session || session.guest) {
      return openAuth(() => openCheckout(planId), { needEmail: true, sub: ["auth_sub_pass", { plan: planName(planId) }] });
    }
    payOpenFor = planId;
    renderCheckout();
    openModal("#payModal");
  }
  function renderCheckout() {
    const pl = planById(payOpenFor); if (!pl) return;
    $("#payBody").innerHTML = `
      <p class="eyebrow eyebrow-ink">${esc(t("checkout"))}</p>
      <h2>${esc(planName(pl.id))}</h2>
      <p class="pay-price">${planPrice(pl)} <small>${esc(t(pl.per))}</small></p>
      <ul class="pay-feats">${t("f_" + pl.id).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <p class="pay-to">${esc(t("receipt"))} <b>${esc(session.email)}</b></p>
      <button class="btn btn-ink btn-wide" id="payGo">${esc(t("confirm", { price: planPrice(pl) }))}</button>
      <p class="fine">${esc(t("pay_fine"))}</p>`;
    $("#payGo").onclick = () => {
      const all = store.get("fs_plans", {});
      all[session.email] = Object.assign({}, all[session.email], { [pl.id]: true });
      store.set("fs_plans", all);
      closeModal($("#payModal"));
      renderAccount(); renderPlans(); renderBuy();
      if (lastEstimate) renderSellResult();
      toast(t("t_activated", { plan: planName(pl.id) }));
    };
  }

  // ---------- SELL ----------
  const freq = (arr) => { const m = new Map(); arr.forEach((v) => m.set(v, (m.get(v) || 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]).map((x) => x[0]); };
  const opt = (v, label = v) => `<option value="${esc(v)}">${esc(label)}</option>`;
  $("#dlModels").innerHTML = freq(rows.map((r) => r.model)).map((m) => `<option value="${esc(m)}">`).join("");
  $("#dlCpus").innerHTML = freq(rows.map((r) => r.cpu)).map((m) => `<option value="${esc(m)}">`).join("");
  $("#dlGpus").innerHTML = freq(rows.map((r) => r.gpu)).map((m) => `<option value="${esc(m)}">`).join("");
  $("#fBrand").innerHTML = brands.slice().sort().map((b) => opt(b)).join("") + opt("Other");
  $("#bBrand").insertAdjacentHTML("beforeend", brands.slice().sort().map((b) => opt(b)).join(""));
  $("#fRam").innerHTML = [4, 8, 12, 16, 18, 24, 32, 36, 48, 64, 96, 128].map((v) => opt(v, v + " GB")).join("");
  $("#fStorage").innerHTML = [64, 128, 256, 512, 1000, 2000, 4000, 8000].map((v) => opt(v, storageLabel(v))).join("");
  const INCHES = [11.6, 13, 13.3, 13.6, 14, 14.5, 15, 15.3, 15.6, 16, 16.1, 17, 17.3, 18];
  $("#fInches").innerHTML = INCHES.map((v) => opt(v, v + '"')).join("");
  const RES = [[1366, 768, "HD"], [1920, 1080, "Full HD"], [1920, 1200, "WUXGA"], [2560, 1440, "QHD"], [2560, 1600, "QHD+"], [2880, 1800, "2.8K"], [3200, 2000, "3.2K"], [3840, 2400, "4K"]];
  $("#fRes").innerHTML = RES.map(([x, y, n]) => opt(`${x}x${y}`, `${n} · ${x}×${y}`)).join("");
  $("#fBrand").value = "HP"; $("#fRam").value = "16"; $("#fStorage").value = "512"; $("#fInches").value = "15.6"; $("#fRes").value = "1920x1080";

  function ensureOption(sel, value, label) {
    if (![...sel.options].some((o) => o.value === String(value))) sel.insertAdjacentHTML("beforeend", opt(value, label));
    sel.value = String(value);
  }
  $("#fModel").addEventListener("input", (e) => {
    const r = rows.find((x) => x.model === e.target.value);
    if (!r) return;
    ensureOption($("#fBrand"), r.brand, r.brand);
    $("#fOs").value = r.os; $("#fCpu").value = r.cpu; $("#fGpu").value = r.gpu;
    ensureOption($("#fRam"), r.ram, r.ram + " GB");
    ensureOption($("#fStorage"), r.storage, storageLabel(r.storage));
    $("#fStype").value = r.stype === "ssd" ? "ssd" : "hdd";
    ensureOption($("#fInches"), r.inches, r.inches + '"');
    if (r.xr && r.yr) ensureOption($("#fRes"), `${r.xr}x${r.yr}`, `${r.xr}×${r.yr}`);
    $("#fTouch").checked = !!r.touch;
    $("#specsFound").hidden = false;
  });

  function chipGroup(el, onChange) {
    el.addEventListener("click", (e) => {
      const c = e.target.closest(".chip"); if (!c) return;
      $$(".chip", el).forEach((x) => x.classList.toggle("on", x === c));
      onChange && onChange(c.dataset.v);
    });
  }
  chipGroup($("#fCond"));
  chipGroup($("#fAgeChips"), (v) => ($("#fAge").value = v));

  // 3-step wizard: 1 machine → 2 condition → 3 result
  function goStep(n) {
    $$("#sellForm [data-panel], .wiz-result").forEach((p) => (p.hidden = +p.dataset.panel !== n));
    $$("#wizSteps li").forEach((li) => {
      const s = +li.dataset.step;
      li.classList.toggle("on", s === n);
      li.classList.toggle("done", s < n);
    });
    $("#wizSteps").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-next]"); if (!b) return;
    const n = +b.dataset.next;
    if (n === 2 && (!$("#fCpu").value.trim() || !$("#fGpu").value.trim())) {
      $("#wizErr").textContent = t("need_cpu_gpu");
      ($("#fCpu").value.trim() ? $("#fGpu") : $("#fCpu")).focus();
      return;
    }
    $("#wizErr").textContent = "";
    goStep(n);
  });
  goStep(1);

  let lastEstimate = null;
  $("#sellForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!$("#fCpu").value.trim() || !$("#fGpu").value.trim()) { goStep(1); $("#wizErr").textContent = t("need_cpu_gpu"); return; }
    requireSession(() => {
      const [xr, yr] = $("#fRes").value.split("x").map(Number);
      const inches = +$("#fInches").value;
      const spec = {
        brand: $("#fBrand").value, os: $("#fOs").value, cpu: $("#fCpu").value, gpu: $("#fGpu").value,
        ram: +$("#fRam").value, storage: +$("#fStorage").value, stype: $("#fStype").value,
        inches, xr, yr, ppi: Math.hypot(xr, yr) / inches, touch: $("#fTouch").checked ? 1 : 0,
        model: $("#fModel").value.trim(),
      };
      const est = M.estimate(spec);
      const ageIdx = +$("#fAge").value;
      const condChip = $(".chip.on", $("#fCond"));
      const age = RETENTION[spec.brand === "Apple" || spec.os === "macOS" ? "apple" : "other"][ageIdx];
      const factor = age * +condChip.dataset.v * ($("#fBox").checked ? 1.03 : 1);
      lastEstimate = { spec, est, factor, ageKey: "age" + ageIdx, condKey: condChip.dataset.key };
      goStep(3);
      renderSellResult(true);
    });
  });

  const pct = (key, v) => Math.round((rows.filter((r) => r[key] < v).length / rows.length) * 100);
  const lower = (s) => s.toLocaleLowerCase(L.locale());

  function renderSellResult(animate) {
    if (!lastEstimate) return;
    const { spec, est, factor, ageKey, condKey } = lastEstimate;
    const fair = round10(est.price * factor);
    const lo = round10(est.low * factor), hi = round10(est.high * factor);
    const paid = hasAccess("seller");
    const comps = est.comps;
    const drivers = [
      [t("d_cpu"), pct("cpuS", est.cpuS)], [t("d_gpu"), pct("gpuS", est.gpuS)],
      [t("d_ram"), pct("ram", spec.ram)], [t("d_storage"), pct("storage", spec.storage)],
    ];
    const compRow = (r) => { return `<li data-open="${r.id}" class="clickable"><div><b>${esc(r.model)}</b><span>${esc(r.cpu)} · ${r.ram} GB · ${storageLabel(r.storage)}</span></div><em>${rowMoney(r)}</em></li>`; };
    const pos = Math.max(4, Math.min(96, ((fair - lo) / Math.max(1, hi - lo)) * 100));
    const title = spec.model || t("laptop_generic", { brand: spec.brand });

    $("#sellResult").innerHTML = `
      <p class="eyebrow eyebrow-ink">${esc(title)} · ${esc(lower(t(ageKey)))} · ${esc(lower(t(condKey)))}</p>
      <p class="res-label">${esc(t("res_label"))}</p>
      <p class="res-price" id="resPrice">${money(fair)}</p>
      <div class="range"><div class="range-track"><i style="left:${pos}%"></i></div><div class="range-ends"><span>${money(lo)}</span><span>${esc(t("likely_range"))}</span><span>${money(hi)}</span></div></div>
      <div class="res-meta">
        <div><span>${esc(t("same_new", { tax: taxNote() }))}${est.exact ? " · " + esc(t("verified_price")) : ""}</span><b>${est.exact ? rowMoney(est.exact) : money(round10(est.price))}</b></div>
        <div><span>${esc(t("market"))}</span><b>${esc(countryName())}</b></div>
      </div>

      <h3 class="res-h">${esc(t("strategy"))}</h3>
      <div class="strategy ${paid ? "" : "is-locked"}">
        <div><span>${esc(t("quick"))}</span><b>${paid ? money(round10(fair * 0.9)) : mask()}</b><small>${esc(t("quick_s"))}</small></div>
        <div class="mid"><span>${esc(t("fair"))}</span><b>${paid ? money(fair) : mask()}</b><small>${esc(t("fair_s"))}</small></div>
        <div><span>${esc(t("patient"))}</span><b>${paid ? money(round10(fair * 1.08)) : mask()}</b><small>${esc(t("patient_s"))}</small></div>
        ${paid ? "" : `<button class="lock-btn" data-plan="seller">${esc(t("unlock_seller", { price: planPrice(planById("seller")) }))}</button>`}
      </div>

      <h3 class="res-h">${esc(t("stacks"))}</h3>
      <div class="drivers">${drivers.map(([n, p]) => `<div><span>${esc(n)}</span><div class="bar"><i style="--w:${Math.max(3, p)}%"></i></div><b>${esc(t("beats", { p }))}</b></div>`).join("")}</div>

      <h3 class="res-h">${esc(t("closest"))} <small>${esc(t("new_prices"))}</small></h3>
      <ul class="comps">${comps.slice(0, 3).map(compRow).join("")}</ul>
      ${paid ? `<ul class="comps">${comps.slice(3).map(compRow).join("")}</ul>` : `<button class="more-locked" data-plan="seller">${esc(t("more_comps", { n: comps.length - 3 }))}</button>`}

      <button class="btn btn-ink btn-wide" id="listBtn">${esc(paid ? t("list_btn") : t("list_btn_locked"))}</button>`;

    if (animate) countUp($("#resPrice"), fair);
    $("#listBtn").onclick = () => (paid ? openListModal(fair) : openCheckout("seller"));
  }

  function countUp(el, to) {
    const t0 = performance.now(), d = 900;
    const step = (now) => { const k = Math.min(1, (now - t0) / d); el.textContent = money(round10(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // ---------- listings (Supabase) ----------
  let listings = [], listingsState = "idle";
  async function loadListings() {
    if (!sb) { listingsState = "error"; renderListings(); return; }
    listingsState = "loading"; renderListings();
    const { data, error } = await sb.from("listings")
      .select("id, seller_id, title, spec, price_usd, fair_usd, region, city, note, created_at, seller:profiles(display_name)")
      .eq("status", "active").gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(200);
    listingsState = error ? "error" : "ready";
    listings = error ? [] : data;
    renderListings();
  }

  // ---------- messages (Supabase) ----------
  let inbox = [], unread = 0, msgTarget = null;
  async function loadInbox() {
    if (!sb || !session || session.guest) { inbox = []; unread = 0; return; }
    const { data, error } = await sb.from("messages")
      .select("id, listing_id, sender_id, recipient_id, body, read_at, created_at, listing:listings(title), sender:profiles!messages_sender_id_fkey(display_name), recipient:profiles!messages_recipient_id_fkey(display_name)")
      .order("created_at", { ascending: false }).limit(100);
    if (error) return;
    inbox = data;
    unread = data.filter((m) => m.recipient_id === session.id && !m.read_at).length;
    renderAccount();
  }
  function openMessage(target) {
    // target: { listingId, title, recipientId, recipientName, reply }
    msgTarget = target;
    $("#msgTitle").textContent = target.reply ? t("msg_reply_title") : t("msg_title");
    $("#msgAbout").textContent = `${target.recipientName} · ${t("about", { title: target.title })}`;
    $("#msgBody").value = "";
    openModal("#msgModal");
    setTimeout(() => $("#msgBody").focus(), 50);
  }
  $("#msgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!msgTarget || !session || session.guest) return;
    const body = $("#msgBody").value.trim();
    if (!body) return;
    const { error } = await sb.from("messages").insert({ listing_id: msgTarget.listingId, recipient_id: msgTarget.recipientId, body });
    if (error) return toast(authError(error));
    closeModal($("#msgModal")); toast(t("t_sent"));
    loadInbox();
    if (!$("#inboxModal").hidden) renderInbox();
  });
  function renderInbox() {
    const el = $("#inboxList");
    if (!inbox.length) { el.innerHTML = `<p class="inbox-empty">${esc(t("inbox_empty"))}</p>`; return; }
    const dt = new Intl.DateTimeFormat(L.locale(), { dateStyle: "medium", timeStyle: "short" });
    el.innerHTML = inbox.map((m) => {
      const mine = m.sender_id === session.id;
      const other = mine ? m.recipient : m.sender;
      const otherName = (other && other.display_name) || "—";
      const title = (m.listing && m.listing.title) || "";
      return `<article class="msg ${mine ? "mine" : ""} ${!mine && !m.read_at ? "unread" : ""}">
        <header><b>${esc(mine ? t("from_you") + " → " + otherName : otherName)}</b><span>${esc(dt.format(new Date(m.created_at)))}</span></header>
        <p class="msg-about">${esc(t("about", { title }))}</p>
        <p class="msg-body">${esc(m.body)}</p>
        <button class="link-btn" data-reply="${m.id}">${esc(t("reply"))}</button>
      </article>`;
    }).join("");
    $$("[data-reply]", el).forEach((b) => (b.onclick = () => {
      const m = inbox.find((x) => x.id === b.dataset.reply);
      const mine = m.sender_id === session.id;
      const other = mine ? m.recipient : m.sender;
      openMessage({ listingId: m.listing_id, title: (m.listing && m.listing.title) || "", recipientId: mine ? m.recipient_id : m.sender_id, recipientName: (other && other.display_name) || "—", reply: true });
    }));
  }
  async function openInbox() {
    await loadInbox();
    renderInbox();
    openModal("#inboxModal");
    const ids = inbox.filter((m) => m.recipient_id === session.id && !m.read_at).map((m) => m.id);
    if (ids.length) {
      await sb.from("messages").update({ read_at: new Date().toISOString() }).in("id", ids);
      inbox.forEach((m) => { if (ids.includes(m.id)) m.read_at = new Date().toISOString(); });
      unread = 0; renderAccount();
    }
  }

  // ---------- orders: buying a listed laptop (Supabase, supabase/orders.sql) ----------
  // Buyer requests at the listed price → seller accepts (listing becomes sold) or declines.
  // They meet, the buyer checks the laptop and pays in person. No money passes through FairSpec yet.
  let orders = [], buyTarget = null;
  const signedIn = () => session && !session.guest;
  const myOpenOrder = (listingId) => signedIn() && orders.find((o) => o.listing_id === listingId && o.buyer_id === session.id && (o.status === "requested" || o.status === "accepted"));
  const pendingSales = () => (signedIn() ? orders.filter((o) => o.seller_id === session.id && o.status === "requested").length : 0);
  async function loadOrders() {
    if (!sb || !signedIn()) { orders = []; return; }
    const { data, error } = await sb.from("orders")
      .select("id, listing_id, buyer_id, seller_id, title, price_usd, status, created_at, updated_at, buyer:profiles!orders_buyer_id_fkey(display_name), seller:profiles!orders_seller_id_fkey(display_name)")
      .order("created_at", { ascending: false }).limit(100);
    if (error) return;
    orders = data;
    renderAccount(); renderListings(); renderOrders();
  }
  // ---------- demo marketplace (for presentations) ----------
  // Example offers from people for every catalog laptop, so buying, paying by card and chatting can be shown
  // end to end. Nothing is charged and nothing leaves the browser: demo orders and chats live in localStorage,
  // card details are checked locally and forgotten right after "payment".
  const DEMO_NAMES = ["Anna K.", "Lukas M.", "Sofia R.", "Daniel P.", "Marie L.", "Jonas W.", "Elena V.", "Tom B.", "Clara S.", "Max H.", "Lea F.", "Noah G."];
  const DEMO_CITIES = {
    US: ["New York", "Brooklyn", "Austin", "Seattle", "Chicago", "San Francisco", "Boston", "Denver"],
    GB: ["London", "Manchester", "Bristol", "Leeds", "Edinburgh"], DE: ["Berlin", "München", "Hamburg", "Köln", "Frankfurt", "Leipzig"],
    FR: ["Paris", "Lyon", "Marseille", "Bordeaux", "Lille"], ES: ["Madrid", "Barcelona", "Valencia", "Sevilla"],
    IT: ["Roma", "Milano", "Torino", "Bologna"], NL: ["Amsterdam", "Rotterdam", "Utrecht"], AT: ["Wien", "Graz", "Linz"],
    BE: ["Bruxelles", "Antwerpen", "Gent"], IE: ["Dublin", "Cork", "Galway"], PT: ["Lisboa", "Porto", "Braga"], FI: ["Helsinki", "Espoo", "Tampere"],
  };
  const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  let demoCache = {}, demoCacheRegion = null;
  function demoFor(r) {
    if (demoCacheRegion !== regionCode) { demoCache = {}; demoCacheRegion = regionCode; }
    if (demoCache[r.id]) return demoCache[r.id];
    const rnd = seeded(r.id * 7919 + 17), n = rnd() < 0.55 ? 2 : 1, cities = DEMO_CITIES[regionCode] || DEMO_CITIES.DE;
    const ret = RETENTION[r.brand === "Apple" ? "apple" : "other"], out = [];
    for (let k = 0; k < n; k++) {
      const age = Math.floor(rnd() * 3), cond = rnd() < 0.45 ? "cond_new" : "cond_good";
      // a used laptop is worth less than buying it new today, so start from the lower of store price and fair price
      const fair = Math.min(r.price, r.fair) * ret[age] * (cond === "cond_new" ? 1.05 : 1);
      out.push({
        id: `d${r.id}_${k}`, demo: true, seller_id: "demo", seller: { display_name: DEMO_NAMES[Math.floor(rnd() * DEMO_NAMES.length)] },
        title: r.model, spec: { brand: r.brand, model: r.model, os: r.os, cpu: r.cpu, gpu: r.gpu, ram: r.ram, storage: r.storage, stype: r.stype, inches: r.inches, xr: r.xr, yr: r.yr, touch: r.touch },
        price_usd: Math.max(50, Math.round((fair * (0.86 + rnd() * 0.26)) / 5) * 5), fair_usd: round10(fair),
        region: regionCode, city: cities[Math.floor(rnd() * cities.length)], cond, age: "age" + age, noteKey: "demo_note" + (1 + Math.floor(rnd() * 4)),
      });
    }
    return (demoCache[r.id] = out);
  }
  const demoShowcase = () => rows.slice().sort((a, b) => b.ratio - a.ratio).slice(0, 12).map((r) => demoFor(r)[0]);
  function findListing(id) {
    const m = /^d(\d+)_(\d+)$/.exec(id || "");
    if (m) { const r = rows.find((x) => x.id === +m[1]); return r ? demoFor(r)[+m[2]] : null; }
    return listings.find((x) => x.id === id);
  }
  const noteOf = (l) => (l.demo ? t(l.noteKey) : l.note);
  let demoOrders = store.get("fs_demo_orders", []);
  if (!Array.isArray(demoOrders)) demoOrders = [];
  const saveDemoOrders = () => store.set("fs_demo_orders", demoOrders.slice(0, 50));
  const demoOrderFor = (id) => demoOrders.find((o) => o.listing_id === id && o.status === "paid");
  // Shared demo (supabase/demo.sql): every device sees the same demo purchases and chats.
  // localStorage stays as a fallback when the server can't be reached.
  let demoSig = "";
  async function loadDemoOrders() {
    if (!sb) return;
    const { data, error } = await sb.from("demo_orders").select("id, listing_id, title, price_usd, seller, city, last4, delivery, status, created_at").order("created_at", { ascending: false }).limit(30);
    if (error) return;
    const sig = JSON.stringify(data);
    if (sig === demoSig) return;
    demoSig = sig; demoOrders = data.map((o) => ({ ...o, price_usd: +o.price_usd })); saveDemoOrders();
    renderOrders(); renderListings();
    if (!$("#chatModal").hidden) renderChat(typingFor === (chatTarget && chatTarget.id));
  }

  // ---------- checkout: delivery + card (demo payment) ----------
  const SHIP_USD = 15;
  let coDelivery = "meet";
  function openBuy(l) {
    if (!l) return;
    if (!l.demo && !signedIn()) return openAuth(() => openBuy(l), { needEmail: true, sub: ["buy_need_account"] });
    buyTarget = l; coDelivery = "meet";
    $("#coForm").reset(); $("#coErr").textContent = "";
    $("#buyStage").hidden = false; $("#buyDone").hidden = true;
    renderBuyModal(); paintCard();
    openModal("#buyModal");
  }
  function renderBuyModal() {
    const l = buyTarget; if (!l) return;
    const v = M.verdict(l.fair_usd / l.price_usd);
    $("#buyTitle").textContent = l.title;
    $("#buySeller").textContent = `${(l.seller && l.seller.display_name) || "—"} · ${l.city}${REGIONS[l.region] ? ", " + countryName(l.region) : ""}${l.demo ? " · " + t(l.cond) + " · " + t(l.age) : ""}`;
    $("#buyPrice").innerHTML = `${money(l.price_usd)} <span class="pill ${v.cls}">${esc(verdictLabel(v))}</span>`;
    $("#buyFair").textContent = t("fair_x", { price: money(l.fair_usd) });
    $$(".chip", $("#coDelivery")).forEach((c) => c.classList.toggle("on", c.dataset.v === coDelivery));
    $("#coShip").hidden = coDelivery !== "ship"; $("#coAddr").required = coDelivery === "ship";
    $("#coShipLabel").textContent = t("co_ship", { price: money(SHIP_USD) });
    const total = l.price_usd + (coDelivery === "ship" ? SHIP_USD : 0);
    $("#coTotal").innerHTML = `<span>${esc(t("co_total"))}</span><b>${money(total)}</b>`;
    if (!$("#coPay").disabled) $("#coPay").textContent = t("co_pay", { price: money(total) });
    $("#buyMsg").placeholder = t("buy_msg_ph");
  }
  $("#coDelivery").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; coDelivery = c.dataset.v; renderBuyModal(); });
  const digits = (v) => String(v).replace(/\D/g, "");
  const luhn = (n) => { let s = 0; for (let i = 0; i < n.length; i++) { let d = +n[n.length - 1 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; } return n.length >= 13 && s % 10 === 0; };
  const cardBrand = (n) => (/^4/.test(n) ? "VISA" : /^(5[1-5]|2[2-7])/.test(n) ? "Mastercard" : /^3[47]/.test(n) ? "AMEX" : "");
  function paintCard() {
    const n = digits($("#cNum").value);
    $("#cvNum").textContent = (n.slice(0, 16).padEnd(16, "•").match(/.{4}/g) || []).join(" ");
    $("#cvName").textContent = $("#cName").value.trim().toUpperCase() || t("co_name_ph").toUpperCase();
    $("#cvExp").textContent = $("#cExp").value || "MM/YY";
    $("#cvBrand").textContent = cardBrand(n);
  }
  $("#cNum").addEventListener("input", (e) => { e.target.value = digits(e.target.value).slice(0, 19).replace(/(.{4})/g, "$1 ").trim(); paintCard(); });
  $("#cExp").addEventListener("input", (e) => { const n = digits(e.target.value).slice(0, 4); e.target.value = n.length > 2 ? n.slice(0, 2) + "/" + n.slice(2) : n; paintCard(); });
  $("#cCvc").addEventListener("input", (e) => { e.target.value = digits(e.target.value).slice(0, 4); });
  $("#cName").addEventListener("input", paintCard);
  $("#cTest").addEventListener("click", () => {
    $("#cNum").value = "4242 4242 4242 4242"; $("#cExp").value = "12/30"; $("#cCvc").value = "123";
    $("#cName").value = session && !session.guest ? sessionName() : "Alex Demo"; paintCard();
  });
  function cardError() {
    if (coDelivery === "ship" && !$("#coAddr").value.trim()) return t("co_err_addr");
    const [mm, yy] = $("#cExp").value.split("/").map(Number);
    if (!luhn(digits($("#cNum").value))) return t("co_err_num");
    if (!(mm >= 1 && mm <= 12) || !(yy >= 0) || new Date(2000 + yy, mm, 1) <= new Date()) return t("co_err_exp");
    if (!/^\d{3,4}$/.test($("#cCvc").value)) return t("co_err_cvc");
    if (!$("#cName").value.trim()) return t("co_err_name");
    return "";
  }
  $("#coForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const l = buyTarget; if (!l) return;
    const err = cardError(); $("#coErr").textContent = err; if (err) return;
    const btn = $("#coPay"); btn.disabled = true; btn.textContent = t("co_processing");
    const last4 = digits($("#cNum").value).slice(-4), note = $("#buyMsg").value.trim();
    const total = l.price_usd + (coDelivery === "ship" ? SHIP_USD : 0);
    const forgetCard = () => ["#cNum", "#cExp", "#cCvc", "#cName"].forEach((s) => ($(s).value = ""));
    await new Promise((r) => setTimeout(r, 1400));
    if (l.demo) {
      // only the public test card's last digits are shared; a real card number is never stored anywhere
      const rec = { listing_id: l.id, title: l.title, price_usd: total, seller: l.seller.display_name, city: l.city, last4: digits($("#cNum").value) === "4242424242424242" ? "4242" : null, delivery: coDelivery, status: "paid" };
      const res = sb ? await sb.from("demo_orders").insert(rec).select().single() : { error: true };
      demoOrders.unshift(res.error ? { ...rec, id: "o" + Date.now(), created_at: new Date().toISOString() } : { ...res.data, price_usd: +res.data.price_usd });
      saveDemoOrders();
    } else {
      const { error } = await sb.from("orders").insert({ listing_id: l.id, seller_id: l.seller_id, title: l.title, price_usd: l.price_usd });
      if (error) {
        btn.disabled = false; forgetCard(); paintCard(); renderBuyModal();
        $("#coErr").textContent = /order_limit/.test(error.message || "") ? t("order_limit") : /duplicate|unique/.test(error.message || "") ? t("buy_requested") : authError(error);
        return;
      }
      await sb.from("messages").insert({ listing_id: l.id, recipient_id: l.seller_id, body: (t("buy_auto_msg", { price: money(l.price_usd) }) + (note ? "\n\n" + note : "")).slice(0, 1000) });
      loadOrders(); loadInbox();
    }
    forgetCard(); btn.disabled = false;
    $("#buyStage").hidden = true;
    const done = $("#buyDone"); done.hidden = false;
    done.innerHTML = `<div class="done-mark">✓</div>
      <h2>${esc(t("co_done_h"))}</h2>
      <p class="section-sub">${esc(t("co_done_p", { price: money(total), last4, seller: (l.seller && l.seller.display_name) || "—" }))}</p>
      <ol class="buy-steps"><li>${esc(t("co_done_s1"))}</li><li>${esc(t(coDelivery === "ship" ? "co_done_s2_ship" : "co_done_s2_meet"))}</li><li>${esc(t("co_done_s3"))}</li></ol>
      <div class="lap-actions"><button class="btn btn-ink" data-goorders>${esc(t("co_to_orders"))}</button>${l.demo ? `<button class="btn btn-glass" data-chat="${esc(l.id)}">${esc(t("ord_msg_seller"))}</button>` : ""}</div>`;
    renderListings(); renderOrders();
  });

  // ---------- demo chat with a seller ----------
  let chats = store.get("fs_demo_chats", {}), chatTarget = null;
  if (!chats || typeof chats !== "object") chats = {};
  let typingFor = null;
  function openChat(l) { chatTarget = l; renderChat(); openModal("#chatModal"); loadChat(l); setTimeout(() => $("#chatInput").focus(), 50); }
  async function loadChat(l) {
    if (!sb) return;
    const { data, error } = await sb.from("demo_messages").select("from_seller, body").eq("listing_id", l.id).order("created_at").limit(80);
    if (error) return;
    const th = data.map((m) => ({ me: !m.from_seller, text: m.body }));
    if (JSON.stringify(th) === JSON.stringify(chats[l.id] || [])) return;
    chats[l.id] = th; store.set("fs_demo_chats", chats);
    if (chatTarget === l) renderChat(typingFor === l.id);
  }
  function pushChat(l, msg) {
    (chats[l.id] = chats[l.id] || []).push(msg);
    store.set("fs_demo_chats", chats);
    if (sb) sb.from("demo_messages").insert({ listing_id: l.id, from_seller: !msg.me, body: msg.text }).then(() => {});
  }
  // keep every open screen in step with the shared demo
  setInterval(() => {
    if (document.hidden) return;
    loadDemoOrders();
    if (chatTarget && !$("#chatModal").hidden) loadChat(chatTarget);
  }, 4000);
  loadDemoOrders();
  function renderChat(typing) {
    const l = chatTarget; if (!l) return;
    $("#chatWho").textContent = l.seller.display_name;
    $("#chatAbout").textContent = `${l.title} · ${money(l.price_usd)} · ${l.city}`;
    const th = chats[l.id] || [];
    $("#chatThread").innerHTML = (th.length ? "" : `<p class="inbox-empty">${esc(t("chat_start"))}</p>`)
      + th.map((m) => `<div class="${m.me ? "msg-u" : "msg-b"}"><p>${esc(m.text)}</p></div>`).join("")
      + (typing ? `<div class="msg-b typing" aria-label="…"><i></i><i></i><i></i></div>` : "");
    $("#chatThread").scrollTop = 1e9;
    $("#chatBuy").innerHTML = demoOrderFor(l.id) ? `<button class="btn btn-glass" data-goorders>${esc(t("demo_paid_btn"))}</button>`
      : `<button class="btn btn-ink" data-buy="${esc(l.id)}">${esc(t("buy_for", { price: money(l.price_usd) }))}</button>`;
    $$("[data-q]", $("#chatModal")).forEach((b) => (b.textContent = t(b.dataset.q)));
  }
  function demoReply(l, text, n) {
    const p = { price: money(l.price_usd), low: money(Math.round((l.price_usd * 0.95) / 5) * 5), city: l.city };
    if (/скид|дешев|discount|cheaper|lower|descuento|rebaj|rabatt|günstig|remise|moins cher|baisse/i.test(text)) return t("demo_r_discount", p);
    if (/встрет|где|достав|meet|where|ship|deliver|quedar|dónde|envío|treffen|wo |versand|rencontr|où|livr/i.test(text)) return t("demo_r_meet", p);
    if (/батар|аккум|battery|batería|akku|batterie/i.test(text)) return t("demo_r_battery", p);
    return t(n ? "demo_r_generic" : "demo_r_hi", p);
  }
  function sendChat(text) {
    const l = chatTarget; if (!l || !text) return;
    const n = (chats[l.id] || []).filter((m) => !m.me).length;
    pushChat(l, { me: true, text: text.slice(0, 600) });
    typingFor = l.id; renderChat(true);
    setTimeout(() => { pushChat(l, { me: false, text: demoReply(l, text, n) }); typingFor = null; if (chatTarget === l) renderChat(); }, 1300);
  }
  $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#chatInput").value.trim(); $("#chatInput").value = ""; sendChat(v); });
  $("#chatModal").addEventListener("click", (e) => { const q = e.target.closest("[data-q]"); if (q) sendChat(t(q.dataset.q)); });

  const ORDER_ST = { requested: "ord_requested", accepted: "ord_accepted", declined: "ord_declined", cancelled: "ord_cancelled" };
  function renderOrders() {
    const box = $("#ordersBox"); if (!box) return;
    if (!session && !demoOrders.length) { box.hidden = true; return; }
    box.hidden = false;
    const dt = new Intl.DateTimeFormat(L.locale(), { dateStyle: "medium" });
    const row = (o) => {
      const selling = o.seller_id === session.id;
      const other = selling ? o.buyer : o.seller;
      const otherName = (other && other.display_name) || "—";
      const acts = [];
      if (selling && o.status === "requested") acts.push(`<button class="btn btn-ink" data-ord="${o.id}" data-to="accepted">${esc(t("ord_accept"))}</button>`, `<button class="btn btn-outline" data-ord="${o.id}" data-to="declined">${esc(t("ord_decline"))}</button>`);
      if ((!selling && o.status === "requested") || o.status === "accepted") acts.push(`<button class="btn btn-outline" data-ord="${o.id}" data-to="cancelled">${esc(t("ord_cancel"))}</button>`);
      if (o.status === "requested" || o.status === "accepted") acts.push(`<button class="link-btn" data-ordmsg="${o.id}">${esc(t(selling ? "ord_msg_buyer" : "ord_msg_seller"))}</button>`);
      return `<article class="order glass st-${o.status}">
        <header><b>${esc(o.title)}</b><span class="ord-st">${esc(t(ORDER_ST[o.status]))}</span></header>
        <p class="ord-meta">${money(o.price_usd)} · ${esc(t(selling ? "ord_buyer" : "ord_seller", { name: otherName }))} · ${esc(dt.format(new Date(o.created_at)))}</p>
        ${o.status === "accepted" ? `<p class="safety">${esc(t("ord_next"))}</p>` : ""}
        ${acts.length ? `<div class="you-row">${acts.join("")}</div>` : ""}
      </article>`;
    };
    const demoRow = (o) => `<article class="order glass st-${o.status}">
        <header><b>${esc(o.title)}</b><span class="ord-st">${esc(t("demo_st_" + o.status))}</span></header>
        <p class="ord-meta">${money(o.price_usd)} · •••• ${esc(o.last4 || "")} · ${esc(t("ord_seller", { name: o.seller }))} · ${esc(dt.format(new Date(o.created_at)))}</p>
        ${o.status === "paid" ? `<p class="safety">${esc(t("demo_escrow"))}</p>
        <div class="you-row"><button class="btn btn-ink" data-demo="${o.id}" data-to="done">${esc(t("demo_received"))}</button><button class="btn btn-outline" data-demo="${o.id}" data-to="refunded">${esc(t("demo_refund"))}</button><button class="link-btn" data-chat="${esc(o.listing_id)}">${esc(t("ord_msg_seller"))}</button></div>` : ""}
      </article>`;
    const sales = signedIn() ? orders.filter((o) => o.seller_id === session.id) : [];
    const buys = signedIn() ? orders.filter((o) => o.buyer_id === session.id) : [];
    const buyHtml = demoOrders.map(demoRow).join("") + buys.map(row).join("");
    box.innerHTML = `<h2 class="block-title">${esc(t("orders_h"))}</h2>
      <div class="orders-cols">
        <div><h3>${esc(t("orders_buying"))}</h3>${buyHtml || `<p class="inbox-empty">${esc(t("orders_none_buy"))}</p>`}</div>
        <div><h3>${esc(t("orders_selling"))}${pendingSales() ? ` <span class="count">${pendingSales()}</span>` : ""}</h3>${sales.length ? sales.map(row).join("") : `<p class="inbox-empty">${esc(t("orders_none_sell"))}</p>`}</div>
      </div>`;
    $$("[data-demo]", box).forEach((b) => (b.onclick = () => {
      const o = demoOrders.find((x) => x.id === b.dataset.demo); if (!o) return;
      o.status = b.dataset.to; saveDemoOrders();
      toast(t("t_demo_" + o.status)); renderOrders(); renderListings();
      if (sb && !/^o\d+$/.test(o.id)) sb.from("demo_orders").update({ status: o.status }).eq("id", o.id).then(() => {});
    }));
    $$("[data-ord]", box).forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      const { error } = await sb.from("orders").update({ status: b.dataset.to }).eq("id", b.dataset.ord);
      if (error) { b.disabled = false; return toast(/order_state/.test(error.message || "") ? t("order_state") : authError(error)); }
      toast(t("t_ord_" + b.dataset.to));
      await loadOrders(); loadListings();
    }));
    $$("[data-ordmsg]", box).forEach((b) => (b.onclick = () => {
      const o = orders.find((x) => x.id === b.dataset.ordmsg);
      const selling = o.seller_id === session.id;
      const other = selling ? o.buyer : o.seller;
      openMessage({ listingId: o.listing_id, title: o.title, recipientId: selling ? o.buyer_id : o.seller_id, recipientName: (other && other.display_name) || "—" });
    }));
  }

  let listFair = 0;
  function renderListModalText() {
    $("#listSub").textContent = t("list_sub", { price: money(listFair) });
    $("#lPriceLabel").textContent = t("ask_price", { cur: displayCur() });
  }
  function openListModal(fair) {
    listFair = fair;
    renderListModalText();
    $("#lPrice").value = round10(toDisp(fair));
    openModal("#listModal");
  }
  $("#listForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb || !session || session.guest) return;
    const { spec, est, factor } = lastEstimate;
    const clean = {
      brand: String(spec.brand).slice(0, 40), model: String(spec.model || "").slice(0, 80), os: spec.os,
      cpu: String(spec.cpu).slice(0, 80), gpu: String(spec.gpu).slice(0, 80), ram: spec.ram, storage: spec.storage,
      stype: spec.stype, inches: spec.inches, xr: spec.xr, yr: spec.yr, touch: spec.touch,
    };
    const btn = e.submitter; if (btn) btn.disabled = true;
    const { error } = await sb.from("listings").insert({
      title: (clean.model || t("laptop_generic", { brand: clean.brand })).slice(0, 120),
      spec: clean,
      price_usd: Math.round(toUsd(+$("#lPrice").value) * 100) / 100,
      fair_usd: round10(est.price * factor),
      region: regionCode,
      city: $("#lCity").value.trim().slice(0, 80),
      note: $("#lNote").value.trim().slice(0, 120) || null,
    });
    if (btn) btn.disabled = false;
    if (error) return toast(authError(error));
    closeModal($("#listModal")); $("#listForm").reset();
    toast(t("t_published"));
    loadListings();
  });

  function listingCard(l) {
    const v = M.verdict(l.fair_usd / l.price_usd), s = l.spec || {}, note = noteOf(l);
    const seller = (l.seller && l.seller.display_name) || "—";
    return `<article class="card glass clickable" data-listing="${esc(l.id)}" tabindex="0" role="button" aria-label="${esc(l.title)}">
        <div class="card-top"><span class="pill ${v.cls}">${esc(verdictLabel(v))}</span>${s.brand ? `<span class="brand">${esc(s.brand)}</span>` : ""}</div>
        <h3>${esc(l.title)}</h3>
        <p class="card-sub">${esc(seller)} · ${esc(l.city)}${REGIONS[l.region] ? ", " + esc(countryName(l.region)) : ""}</p>
        ${l.demo ? `<p class="card-sub">${esc(t(l.cond))} · ${esc(t(l.age))}</p>` : ""}
        <p class="card-price">${money(l.price_usd)} <small>${esc(t("fair_x", { price: money(l.fair_usd) }))}</small></p>
        <ul class="specs"><li>${esc(s.cpu)}</li><li>${esc(gpuShort(s.gpu || ""))}</li><li>${+s.ram || "?"} GB · ${storageLabel(+s.storage || 0)} ${ST_LABEL[s.stype] || ""}</li><li>${+s.inches || "?"}"${+s.xr ? " · " + +s.xr + "×" + +s.yr : ""}</li></ul>
        ${note ? `<p class="note">“${esc(note)}”</p>` : ""}
        ${listingActions(l)}
      </article>`;
  }
  function renderListings() {
    const all = listings.concat(demoShowcase());
    $("#listCount").textContent = all.length;
    $("#listingCards").innerHTML = all.map(listingCard).join("");
  }
  function listingActions(l) {
    if (l.demo) {
      return (demoOrderFor(l.id) ? `<button class="btn btn-glass btn-wide" data-myorders>${esc(t("demo_paid_btn"))}</button>`
          : `<button class="btn btn-ink btn-wide" data-buy="${esc(l.id)}">${esc(t("buy_for", { price: money(l.price_usd) }))}</button>`)
        + `<button class="btn btn-outline btn-wide" data-contact="${esc(l.id)}">${esc(t("contact"))}</button>`;
    }
    const mine = signedIn() && session.id === l.seller_id;
    if (mine) return `<button class="btn btn-outline btn-wide" data-remove="${esc(l.id)}">${esc(t("remove_mine"))}</button>`;
    const o = myOpenOrder(l.id);
    return (o ? `<button class="btn btn-glass btn-wide" data-myorders>${esc(t(o.status === "accepted" ? "ord_accepted" : "buy_requested"))}</button>`
        : `<button class="btn btn-ink btn-wide" data-buy="${esc(l.id)}">${esc(t("buy_for", { price: money(l.price_usd) }))}</button>`)
      + (hasAccess("buyer") ? `<button class="btn btn-outline btn-wide" data-contact="${esc(l.id)}">${esc(t("contact"))}</button>`
        : `<button class="btn btn-outline btn-wide" data-plan="buyer">${esc(t("contact_locked"))}</button>`);
  }
  const goOrders = () => { location.hash = "#you"; setTimeout(() => { const o = $("#ordersBox"); if (o) o.scrollIntoView({ behavior: "smooth" }); }, 80); };
  // listing buttons work everywhere (cards, the laptop profile, checkout and chat)
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-buy],[data-myorders],[data-goorders],[data-remove],[data-contact],[data-chat]"); if (!b) return;
    e.stopPropagation();
    ["#laptopModal", "#buyModal", "#chatModal"].forEach((id) => { const m = $(id); if (!m.hidden) closeModal(m); });
    if (b.dataset.buy) return openBuy(findListing(b.dataset.buy));
    if (b.hasAttribute("data-myorders") || b.hasAttribute("data-goorders")) return goOrders();
    if (b.dataset.remove) {
      const { error } = await sb.from("listings").delete().eq("id", b.dataset.remove);
      if (error) return toast(authError(error));
      toast(t("t_removed")); return loadListings();
    }
    const l = findListing(b.dataset.contact || b.dataset.chat); if (!l) return;
    if (l.demo) return openChat(l);
    requireSession(() => openMessage({ listingId: l.id, title: l.title, recipientId: l.seller_id, recipientName: (l.seller && l.seller.display_name) || "—" }));
  }, true);

  // ---------- QR code so the audience can open the same demo on their phones ----------
  // qrcodejs is loaded from cdnjs only when the QR is opened.
  let qrLib = null;
  const loadQrLib = () => qrLib || (qrLib = new Promise((ok, fail) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    sc.onload = ok; sc.onerror = () => { qrLib = null; fail(); };
    document.head.appendChild(sc);
  }));
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-qr]")) return;
    const url = location.origin + location.pathname;
    $("#qrUrl").textContent = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    $("#qrBox").innerHTML = "";
    openModal("#qrModal");
    try { await loadQrLib(); new window.QRCode($("#qrBox"), { text: url, width: 260, height: 260, colorDark: "#0c0d10", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M }); }
    catch { $("#qrBox").textContent = t("err_offline"); }
  });

  // ---------- laptop profile: open any laptop card ----------
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function listingsFor(r) {
    const m = norm(r.model), c = norm(r.cpu);
    const real = listings.filter((l) => {
      const s = l.spec || {}; if (s.brand !== r.brand) return false;
      const lm = norm(s.model || l.title);
      return (lm && m && (lm.includes(m) || m.includes(lm))) || (c && norm(s.cpu) === c);
    }).sort((a, b) => ((b.spec.ram === r.ram) + (b.spec.storage === r.storage)) - ((a.spec.ram === r.ram) + (a.spec.storage === r.storage)) || a.price_usd - b.price_usd);
    return real.concat(demoFor(r));
  }
  function similarCheaper(r) {
    const p = r.cpuS + r.gpuS;
    return rows.filter((x) => x.id !== r.id && x.price < r.price && Math.abs(x.cpuS + x.gpuS - p) <= 12 && x.ram >= r.ram && Math.abs(x.inches - r.inches) <= 2.5)
      .sort((a, b) => b.ratio - a.ratio).slice(0, 3);
  }
  const specTable = (items) => `<dl class="lap-specs">${items.filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
  const miniListing = (l) => {
    const v = M.verdict(l.fair_usd / l.price_usd), s = l.spec || {}, note = noteOf(l);
    return `<article class="lap-offer glass clickable" data-listing="${esc(l.id)}">
      <header><b>${money(l.price_usd)}</b><span class="pill ${v.cls}">${esc(verdictLabel(v))}</span></header>
      <p class="ord-meta">${esc((l.seller && l.seller.display_name) || "—")} · ${esc(l.city)} · ${l.demo ? esc(t(l.cond)) + " · " + esc(t(l.age)) : `${+s.ram || "?"} GB · ${storageLabel(+s.storage || 0)}`}</p>
      ${note ? `<p class="note">“${esc(note)}”</p>` : ""}
      <div class="you-row">${listingActions(l)}</div>
    </article>`;
  };
  function openProfile(kind, id) {
    const body = $("#lapBody");
    if (kind === "row") {
      const r = rows.find((x) => x.id === +id); if (!r) return;
      const v = M.verdict(r.ratio);
      const diff = r.price - r.fair;
      const diffTxt = Math.abs(diff) < r.fair * 0.04 ? t("in_line") : diff < 0 ? t("below", { v: money(-diff) }) : t("above", { v: money(diff) });
      const offers = listingsFor(r), alts = similarCheaper(r);
      body.innerHTML = `<p class="eyebrow">${esc(r.brand)}</p>
        <h2>${esc(r.model)}</h2>
        <p class="buy-price">${rowMoney(r)} <span class="pill ${v.cls}">${esc(verdictLabel(v))}</span></p>
        <p class="section-sub">${esc(t("lap_new_price"))} · ${esc(t("fair_x", { price: money(r.fair) }))} · ${esc(diffTxt)}</p>
        <div class="perf"><span>CPU</span><i style="--w:${r.cpuS}%"></i><span>GPU</span><i style="--w:${r.gpuS}%"></i></div>
        ${specTable([[t("lap_cpu"), r.cpu], [t("lap_gpu"), r.gpu], [t("lap_mem"), `${r.ram} GB · ${storageLabel(r.storage)} ${ST_LABEL[r.stype] || ""}`], [t("lap_screen"), screenTxt(r) + (r.touch ? " · " + t("touch") : "")], [t("lap_weight"), r.weight ? r.weight + " kg" : ""], [t("lap_os"), r.os]])}
        <div class="lap-actions"><button type="button" class="btn btn-glass" data-cmp="${r.id}">${compareIds.includes(r.id) ? "✓ " : "+ "}${esc(t("compare"))}</button></div>
        ${offers.length ? `<h3 class="lap-h">${esc(t("lap_people"))} <span class="count">${offers.length}</span></h3>${offers.map(miniListing).join("")}` : ""}
        ${alts.length ? `<h3 class="lap-h">${esc(t("lap_similar"))}</h3><ul class="comps">${alts.map((x) => `<li data-open="${x.id}" class="clickable"><div><b>${esc(x.model)}</b><span>${esc(x.cpu)} · ${x.ram} GB · ${storageLabel(x.storage)}</span></div><em>${rowMoney(x)}</em></li>`).join("")}</ul>` : ""}`;
    } else {
      const l = findListing(id); if (!l) return;
      const v = M.verdict(l.fair_usd / l.price_usd), s = l.spec || {}, note = noteOf(l);
      body.innerHTML = `<p class="eyebrow">${esc(s.brand || "")}</p>
        <h2>${esc(l.title)}</h2>
        <p class="section-sub">${esc((l.seller && l.seller.display_name) || "—")} · ${esc(l.city)}${REGIONS[l.region] ? ", " + esc(countryName(l.region)) : ""}${l.demo ? " · " + esc(t(l.cond)) + " · " + esc(t(l.age)) : ""}</p>
        <p class="buy-price">${money(l.price_usd)} <span class="pill ${v.cls}">${esc(verdictLabel(v))}</span></p>
        <p class="section-sub">${esc(t("fair_x", { price: money(l.fair_usd) }))}</p>
        ${specTable([[t("lap_cpu"), s.cpu], [t("lap_gpu"), s.gpu], [t("lap_mem"), `${+s.ram || "?"} GB · ${storageLabel(+s.storage || 0)} ${ST_LABEL[s.stype] || ""}`], [t("lap_screen"), `${+s.inches || "?"}"${+s.xr ? " · " + +s.xr + "×" + +s.yr : ""}${s.touch ? " · " + t("touch") : ""}`], [t("lap_os"), s.os]])}
        ${note ? `<p class="note">“${esc(note)}”</p>` : ""}
        <div class="lap-actions">${listingActions(l)}</div>
        <p class="safety">${esc(t(l.demo ? "co_protect" : "safety_tip"))}</p>`;
    }
    $(".modal-card", $("#laptopModal")).scrollTop = 0;
    if ($("#laptopModal").hidden) openModal("#laptopModal");
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, label")) return;
    const c = e.target.closest("[data-open],[data-listing]"); if (!c) return;
    c.dataset.listing ? openProfile("listing", c.dataset.listing) : openProfile("row", c.dataset.open);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const c = e.target.closest && e.target.closest("[data-open],[data-listing]"); if (!c || e.target !== c) return;
    e.preventDefault(); c.click();
  });

  // ---------- BUY ----------
  const buy = { use: "any", budget: 2000, ram: 0, storage: 0, gpu: "any", screen: "any", brand: "", os: "", sort: "value", shown: 12 };
  const PRESETS = {
    any: { budget: 2000, ram: "0", storage: "0", gpu: "any", screen: "any" },
    study: { budget: 700, ram: "8", storage: "256", gpu: "any", screen: "any" },
    office: { budget: 1100, ram: "16", storage: "512", gpu: "any", screen: "any" },
    creative: { budget: 3000, ram: "32", storage: "1000", gpu: "ded", screen: "any" },
    gaming: { budget: 2500, ram: "16", storage: "1000", gpu: "strong", screen: "any" },
    travel: { budget: 1800, ram: "16", storage: "512", gpu: "any", screen: "small" },
  };
  const USE_CPU = { any: 0, study: 0, office: 35, creative: 55, gaming: 50, travel: 0 };
  const setChip = (id, v) => $$(".chip", $(id)).forEach((c) => c.classList.toggle("on", c.dataset.v === String(v)));

  function setBudget(v) {
    buy.budget = +v; $("#bBudget").value = v;
    $("#bBudgetOut").textContent = +v >= 7500 ? t("budget_nolimit") : t("budget_upto", { v: fmt(v) });
  }
  chipGroup($("#bUse"), (v) => {
    buy.use = v; const p = PRESETS[v];
    setBudget(p.budget);
    buy.ram = +p.ram; setChip("#bRam", p.ram);
    buy.storage = +p.storage; setChip("#bStorage", p.storage);
    buy.gpu = p.gpu; setChip("#bGpu", p.gpu);
    buy.screen = p.screen; setChip("#bScreen", p.screen);
    buy.shown = 12; renderBuy();
  });
  chipGroup($("#bRam"), (v) => { buy.ram = +v; buy.shown = 12; renderBuy(); });
  chipGroup($("#bStorage"), (v) => { buy.storage = +v; buy.shown = 12; renderBuy(); });
  chipGroup($("#bGpu"), (v) => { buy.gpu = v; buy.shown = 12; renderBuy(); });
  chipGroup($("#bScreen"), (v) => { buy.screen = v; buy.shown = 12; renderBuy(); });
  $("#bBudget").addEventListener("input", (e) => { setBudget(e.target.value); buy.shown = 12; renderBuy(); });
  $("#bBrand").addEventListener("change", (e) => { buy.brand = e.target.value; buy.shown = 12; renderBuy(); });
  $("#bOs").addEventListener("change", (e) => { buy.os = e.target.value; buy.shown = 12; renderBuy(); });
  $("#bSort").addEventListener("change", (e) => { buy.sort = e.target.value; renderBuy(); });
  $("#buyForm").addEventListener("submit", (e) => e.preventDefault());

  $$(".tab").forEach((tab) => tab.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("on", x === tab));
    $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab.dataset.tab));
    if (tab.dataset.tab === "listings") loadListings();
  }));

  function matches() {
    return rows.filter((r) =>
      (buy.budget >= 7500 || dispPrice(r) <= buy.budget) &&
      r.ram >= buy.ram && r.storage >= buy.storage &&
      r.cpuS >= USE_CPU[buy.use] &&
      (buy.gpu === "any" || (buy.gpu === "ded" ? r.gpuS >= 38 : r.gpuS >= 58)) &&
      (buy.screen === "any" || (buy.screen === "small" ? r.inches <= 14.5 : buy.screen === "mid" ? r.inches >= 15 && r.inches < 17 : r.inches >= 17)) &&
      (buy.use !== "travel" || r.weight <= 1.6) && (buy.use !== "gaming" || r.os === "Windows") &&
      (!buy.brand || r.brand === buy.brand) && (!buy.os || r.os === buy.os));
  }

  function card(r) {
    const v = M.verdict(r.ratio);
    const diff = r.price - r.fair;
    const diffTxt = Math.abs(diff) < r.fair * 0.04 ? t("in_line") : diff < 0 ? t("below", { v: money(-diff) }) : t("above", { v: money(diff) });
    return `<article class="card glass clickable" data-open="${r.id}" tabindex="0" role="button" aria-label="${esc(r.model)}">
      <div class="card-top"><span class="pill ${v.cls}">${esc(verdictLabel(v))}</span><span class="brand">${esc(r.brand)}</span></div>
      <h3>${esc(r.model)}</h3>
      <p class="card-price">${rowMoney(r)} <small>${r.msrp && r.msrp > r.price * 1.02 && region().cur === "USD" ? esc(t("list_price", { p: money(r.msrp) })) + " · " : ""}${esc(diffTxt)}</small></p>
      <div class="perf"><span>CPU</span><i style="--w:${r.cpuS}%"></i><span>GPU</span><i style="--w:${r.gpuS}%"></i></div>
      <ul class="specs"><li>${esc(r.cpu)}</li><li>${esc(gpuShort(r.gpu))}</li><li>${r.ram} GB · ${storageLabel(r.storage)} ${ST_LABEL[r.stype]}</li><li>${screenTxt(r)}${r.weight ? " · " + r.weight + " kg" : ""}</li></ul>
      <span class="open-hint">${esc(t("open_profile"))} →</span>
      <button type="button" class="cmp-toggle ${compareIds.includes(r.id) ? "on" : ""}" data-cmp="${r.id}">${compareIds.includes(r.id) ? "✓ " : "+ "}${esc(t("compare"))}</button>
    </article>`;
  }

  // ---------- compare (up to 4) ----------
  let compareIds = [];
  function renderTray() {
    const tray = $("#compareTray");
    tray.hidden = !compareIds.length || document.body.dataset.view !== "buy";
    $("#compareCount").textContent = t("compare_n", { n: compareIds.length });
    $("#compareGo").disabled = compareIds.length < 2;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmp]"); if (!b) return;
    const id = +b.dataset.cmp;
    if (compareIds.includes(id)) compareIds = compareIds.filter((x) => x !== id);
    else if (compareIds.length >= 4) return toast(t("compare_max"));
    else compareIds.push(id);
    const on = compareIds.includes(id);
    b.classList.toggle("on", on);
    b.textContent = (on ? "✓ " : "+ ") + t("compare");
    const cardEl = b.closest(".card"); if (cardEl) cardEl.classList.toggle("picked", on);
    if (b.closest("#laptopModal")) renderBuy();
    renderTray();
  });
  $("#compareClear").addEventListener("click", () => { compareIds = []; renderBuy(); renderTray(); });
  $("#compareGo").addEventListener("click", () => {
    const list = compareIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
    if (window.FairAssist) $("#compareBody").innerHTML = window.FairAssist.compareHTML(list);
    openModal("#compareModal");
  });
  window.addEventListener("hashchange", renderTray);

  // ---------- "?" spec explanations ----------
  document.addEventListener("click", (e) => {
    const q = e.target.closest(".q[data-term]"); if (!q) return;
    e.preventDefault();
    if (window.FairAssist) window.FairAssist.openTerm(q.dataset.term);
  });

  // ---------- YOU ----------
  function renderYou() {
    const el = $("#youCard"); if (!el) return;
    $("#youPrefsLabel").textContent = `${L.LANGS.find(([c]) => c === L.lang)[1]} · ${countryName()} · ${displayCur()}`;
    if (!session) {
      el.innerHTML = `<h3>${esc(t("you_hello"))}</h3><p>${esc(t("you_signed_out"))}</p>
        <div class="you-row"><button class="btn btn-ink" id="youSignIn">${esc(t("sign_in"))}</button><button class="btn btn-glass" id="youSignUp">${esc(t("signup"))}</button></div>`;
      $("#youSignIn").onclick = () => openAuth();
      $("#youSignUp").onclick = () => { openAuth(); setAuthMode("signup"); };
      return;
    }
    const p = plansFor();
    const plan = p.pro ? planName("pro") : [p.seller && planName("seller"), p.buyer && planName("buyer")].filter(Boolean).join(" + ") || planName("free");
    el.innerHTML = `<h3>${esc(t("you_hi", { name: sessionName() }))}</h3>
      <p>${session.guest ? esc(t("acct_guest")) : esc(session.email)} · ${esc(t("acct_plan"))}: <b>${esc(plan)}</b></p>
      <div class="you-row">
        ${session.guest ? `<button class="btn btn-ink" id="youUpgrade">${esc(t("signup"))}</button>`
          : `<button class="btn btn-ink" id="youInbox">${esc(t("messages"))}${unread ? ` <span class="count">${unread}</span>` : ""}</button>`}
        <button class="btn btn-glass" id="youSignOut">${esc(t("sign_out"))}</button>
      </div>`;
    const up = $("#youUpgrade"); if (up) up.onclick = () => openAuth(null, { needEmail: true, sub: ["auth_sub_keep"] });
    const ib = $("#youInbox"); if (ib) ib.onclick = () => openInbox();
    $("#youSignOut").onclick = () => $("#signOut") ? $("#signOut").click() : null;
  }
  $("#youPrefs").addEventListener("click", () => $("#prefsBtn").click());

  function renderBuy() {
    if (!$("#buyCards")) return;
    renderListings();
    const list = matches();
    const sorters = { value: (a, b) => b.ratio - a.ratio, low: (a, b) => a.price - b.price, perf: (a, b) => b.cpuS + b.gpuS - (a.cpuS + a.gpuS) };
    list.sort(sorters[buy.sort]);
    const sum = $("#buySummary");
    if (!list.length) {
      sum.innerHTML = `<p class="sum-empty">${esc(t("sum_empty"))}</p>`;
      $("#buyCount").textContent = ""; $("#buyCards").innerHTML = ""; $("#buyMore").innerHTML = ""; return;
    }
    const prices = list.map(dispPrice).sort((a, b) => a - b);
    const qp = (p) => prices[Math.floor(p * (prices.length - 1))];
    const deals = list.filter((r) => M.verdict(r.ratio).cls === "good").length;
    const over = list.filter((r) => M.verdict(r.ratio).cls === "bad").length;
    sum.innerHTML = `
      <div><span>${esc(t("typical"))}</span><b>${fmt(round10(qp(0.5)))}</b><small>${esc(t("middle_half", { a: fmt(round10(qp(0.25))), b: fmt(round10(qp(0.75))) }))}</small></div>
      <div><span>${esc(t("deals"))}</span><b class="t-good">${deals}</b><small>${esc(t("deals_s"))}</small></div>
      <div><span>${esc(t("over"))}</span><b class="t-bad">${over}</b><small>${esc(t("over_s"))}</small></div>`;
    $("#buyCount").textContent = tp("count", list.length);
    const paid = hasAccess("buyer");
    const limit = paid ? buy.shown : 6;
    $("#buyCards").innerHTML = list.slice(0, limit).map(card).join("");
    const more = $("#buyMore");
    if (!paid && list.length > 6) {
      more.innerHTML = `<div class="unlock glass"><div><b>${esc(t("more_matches", { n: list.length - 6 }))}</b><p>${esc(t("more_p"))}</p></div><button class="btn btn-ink" data-plan="buyer">${esc(t("unlock_buyer", { price: planPrice(planById("buyer")) }))}</button></div>`;
    } else if (paid && list.length > limit) {
      more.innerHTML = `<button class="btn btn-glass btn-wide" id="showMore">${esc(t("show_more", { n: list.length - limit }))}</button>`;
      $("#showMore").onclick = () => { buy.shown += 12; renderBuy(); };
    } else more.innerHTML = "";
  }

  // ---------- reveal on scroll ----------
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.12 }) : null;
  $$(".tile, .life, .steps li, .block-title").forEach((el) => { el.classList.add("reveal"); io ? io.observe(el) : el.classList.add("in"); });

  // ---------- bridge for the assistant (assistant.js) ----------
  window.FairApp = {
    rows, M, t, tp, esc, money, fmt, round10, toUsd, toDisp, gpuShort, storageLabel, ST_LABEL, verdictLabel,
    region, displayCur, curSymbol, openModal, closeModal, toast, dispPrice, rowMoney, screenTxt,
    goBuy(use) { location.hash = "#buy"; const c = $(`#bUse .chip[data-v="${use}"]`); if (c) c.click(); },
    // same filters as the Buy page, as a function of simple answers
    find({ use = "any", budgetDisp = Infinity, os = "" } = {}) {
      const p = PRESETS[use] || PRESETS.any;
      return rows.filter((r) => dispPrice(r) <= budgetDisp && r.ram >= +p.ram && r.storage >= +p.storage && r.cpuS >= USE_CPU[use] &&
        (p.gpu === "any" || (p.gpu === "ded" ? r.gpuS >= 38 : r.gpuS >= 58)) &&
        (p.screen !== "small" || r.inches <= 14.5) && (use !== "travel" || r.weight <= 1.6) && (use !== "gaming" || r.os === "Windows") &&
        (!os || r.os === os));
    },
  };

  // ---------- render everything in the current language / market / currency ----------
  function renderAll() {
    L.apply();
    $("#footerNote").textContent = t("footer_note", { country: countryName(), tax: taxNote() });
    $("#prefsLabel").textContent = `${L.lang.toUpperCase()} · ${curSymbol()}`;
    $("#artPrice").textContent = money(1240);
    if (!$("#authModal").hidden) { $("#authSub").textContent = t(...authSubKey); setAuthMode(authMode); }
    if (!$("#payModal").hidden) renderCheckout();
    if (!$("#listModal").hidden) renderListModalText();
    setBudget(buy.budget);
    paintScreen(heroRow);
    renderAccount(); renderPlans(); renderBuy(); renderYou(); renderTray();
    $("#dockDot").hidden = !(unread || pendingSales());
    if (!$("#buyModal").hidden && !$("#buyStage").hidden) renderBuyModal();
    if (!$("#chatModal").hidden) renderChat();
    renderOrders();
    renderSellResult();
    if (window.FairAssist) window.FairAssist.rerender();
  }

  // ---------- init ----------
  renderAll();
  route();
  refreshFx();
  if (sb) {
    sb.auth.getSession().then(async ({ data }) => {
      await loadSession(data.session);
      renderAll(); loadInbox(); loadListings(); loadOrders();
    });
    // Supabase advises not to await other Supabase calls inside this callback, hence setTimeout.
    sb.auth.onAuthStateChange((event, s) => {
      setTimeout(async () => {
        if (event === "PASSWORD_RECOVERY") { openAuth(null); setAuthMode("newpass"); return; }
        if (event === "SIGNED_OUT") { if (session && !session.guest) { session = null; orders = []; renderAll(); } return; }
        if (event === "SIGNED_IN" && (!session || session.guest || session.id !== s.user.id)) {
          await loadSession(s); renderAll(); loadInbox(); loadListings(); loadOrders();
        }
      }, 0);
    });
  } else {
    listingsState = "error";
  }
})();
