/* FairSpec Assistant — a guided, private helper (runs entirely in the browser; nothing is sent anywhere).
 * It adapts to the person's level (new / basics / tech), helps choose 4 laptops and compares them,
 * checks whether an offer is fair, explains specs, and walks sellers to the valuation.
 * Built so a language model can be plugged in later for free-form questions.
 */
(function () {
  const A = window.FairApp;
  if (!A) return;
  const { t, esc, money, fmt, M } = A;
  const $ = (s, el = document) => el.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const TERMS = ["cpu", "gpu", "ram", "storage", "screen", "os", "weight"];
  let level = store.get("fs_level", null); // "new" | "some" | "pro"
  const glossLevel = () => (level === "pro" ? "pro" : "new");
  const chat = $("#chat");
  let lastLang = window.I18N.lang, started = false, ctx = {};

  // ---------- glossary popover ----------
  let termShown = null, termLevel = null;
  function openTerm(term) {
    termShown = term; termLevel = glossLevel();
    renderTerm();
    A.openModal("#termModal");
  }
  function renderTerm() {
    if (!termShown) return;
    $("#termTitle").textContent = t(`gl_${termShown}_t`);
    $("#termBody").textContent = t(`gl_${termShown}_${termLevel}`);
    $("#termLevel").textContent = termLevel === "pro" ? t("term_tech") : t("term_simple");
    $("#termLevels").innerHTML = ["new", "pro"].map((l) => `<button type="button" class="chip ${l === termLevel ? "on" : ""}" data-tl="${l}">${esc(l === "pro" ? t("term_tech") : t("term_simple"))}</button>`).join("");
  }
  $("#termLevels").addEventListener("click", (e) => { const b = e.target.closest("[data-tl]"); if (!b) return; termLevel = b.dataset.tl; renderTerm(); });

  // ---------- chat primitives ----------
  const scrollDown = () => requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
  function clearOpts() { chat.querySelectorAll(".chat-opts, .check-form").forEach((el) => el.remove()); }
  function user(text) { clearOpts(); const d = document.createElement("div"); d.className = "msg-u"; d.textContent = text; chat.appendChild(d); scrollDown(); }
  function bot(html, then) {
    clearOpts();
    const typing = document.createElement("div"); typing.className = "msg-b typing"; typing.innerHTML = "<i></i><i></i><i></i>";
    chat.appendChild(typing); scrollDown();
    setTimeout(() => {
      typing.className = "msg-b"; typing.innerHTML = html; scrollDown();
      if (then) then();
    }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420);
  }
  function opts(list) {
    const wrap = document.createElement("div"); wrap.className = "chat-opts";
    list.forEach(({ label, fn }) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = label;
      b.onclick = () => { user(label); fn(); };
      wrap.appendChild(b);
    });
    chat.appendChild(wrap); scrollDown();
  }
  const p = (s) => `<p>${s}</p>`;

  // ---------- flows ----------
  function start(goal) {
    chat.innerHTML = ""; ctx = {}; started = true; lastLang = window.I18N.lang;
    if (!level) {
      bot(p(esc(t("a_hi"))), () => opts([
        { label: t("lvl_new"), fn: () => setLevel("new", goal) },
        { label: t("lvl_some"), fn: () => setLevel("some", goal) },
        { label: t("lvl_pro"), fn: () => setLevel("pro", goal) },
      ]));
    } else if (goal) runGoal(goal);
    else bot(p(esc(t("a_back", { level: t("lvl_" + level) }))), goalMenu);
  }
  function setLevel(l, goal) { level = l; store.set("fs_level", l); goal ? runGoal(goal) : bot(p(esc(t("a_goal"))), goalMenu); }
  function goalMenu() {
    opts([
      { label: t("g_buy"), fn: buyUse },
      { label: t("g_sell"), fn: sellHelp },
      { label: t("g_check"), fn: check },
      { label: t("g_explain"), fn: explainMenu },
      { label: t("change_level"), fn: () => { level = null; store.set("fs_level", null); start(); } },
    ]);
  }
  function runGoal(g) { ({ buy: buyUse, sell: sellHelp, check, explain: explainMenu }[g] || (() => bot(p(esc(t("a_goal"))), goalMenu)))(); }
  const backOpts = () => [{ label: t("explain_more"), fn: explainMenu }, { label: t("start_over"), fn: () => start() }];

  // buy
  function buyUse() {
    bot(p(esc(t("a_use"))), () => opts(["study", "office", "creative", "gaming", "travel", "any"].map((u) => ({ label: t("use_" + u), fn: () => { ctx.use = u; buyBudget(); } }))));
  }
  function buyBudget() {
    const steps = [600, 1000, 1500, 2500];
    bot(p(esc(t("a_budget"))), () => opts([
      ...steps.map((v) => ({ label: t("budget_upto", { v: fmt(v) }), fn: () => { ctx.budget = v; buyPrio(); } })),
      { label: t("budget_nolimit"), fn: () => { ctx.budget = Infinity; buyPrio(); } },
    ]));
  }
  function buyPrio() {
    bot(p(esc(t("a_prio"))), () => opts(["light", "screen", "power", "cheap"].map((k) => ({ label: t("p_" + k), fn: () => { ctx.prio = k; buyResults(); } }))));
  }
  function pickFour(list, prio) {
    const best = new Map();
    list.forEach((r) => { const cur = best.get(r.model); if (!cur || r.ratio > cur.ratio) best.set(r.model, r); });
    const uniq = [...best.values()];
    if (!uniq.length) return [];
    const maxP = Math.max(...uniq.map((r) => r.price));
    const score = (r) => {
      let s = r.ratio * 1.2;
      if (prio === "light") s += (2.4 - Math.min(2.4, r.weight)) * 0.35;
      if (prio === "screen") s += (r.inches - 13) * 0.08 + (r.ppi / 300) * 0.15;
      if (prio === "power") s += (r.cpuS + r.gpuS) / 200 * 0.8;
      if (prio === "cheap") s += (1 - r.price / maxP) * 0.8;
      return s;
    };
    return uniq.sort((a, b) => score(b) - score(a)).slice(0, 4);
  }
  function reasons(r) {
    const out = [];
    if (r.ratio >= 1.05) out.push(t("r_value", { p: Math.round((r.ratio - 1) * 100) }));
    else if (r.ratio >= 0.92) out.push(t("r_fair"));
    if (level === "pro") {
      out.push(`${r.cpu}`, `${A.gpuShort(r.gpu)}`, `${r.ram} GB · ${A.storageLabel(r.storage)} ${A.ST_LABEL[r.stype]}`, A.screenTxt(r) + (r.weight ? ` · ${r.weight} kg` : ""));
      return out;
    }
    if (level === "new") {
      out.push(r.cpuS >= 60 ? t("nr_cpu_hi") : t("nr_cpu_mid"));
      out.push(r.ram >= 16 ? t("nr_ram") : t("nr_ram_low"));
      if (r.gpuS >= 38) out.push(t("nr_gpu"));
      if (r.storage >= 1000) out.push(t("nr_storage"));
      if (r.weight && r.weight <= 1.5) out.push(t("nr_light"));
      return out.slice(0, 4);
    }
    out.push(t("r_ram", { gb: r.ram }));
    if (r.storage >= 1000) out.push(t("r_storage", { tb: A.storageLabel(r.storage) }));
    if (r.gpuS >= 38) out.push(t("r_games"));
    if (r.weight && r.weight <= 1.5) out.push(t("r_light", { kg: r.weight }));
    if (r.inches >= 16) out.push(t("r_screen", { in: r.inches }));
    return out.slice(0, 4);
  }
  function pickCard(r, i) {
    const v = M.verdict(r.ratio);
    return `<div class="pick ${i === 0 ? "top" : ""}">
      <small>${i === 0 ? esc(t("a_best")) : esc(r.brand)}</small>
      <b>${esc(r.model)}</b>
      <span class="p">${A.rowMoney(r)}</span>
      <span class="pill ${v.cls}" style="justify-self:start">${esc(A.verdictLabel(v))}</span>
      <ul>${reasons(r).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>`;
  }
  function buyResults() {
    const list = A.find({ use: ctx.use, budgetDisp: ctx.budget });
    const picks = pickFour(list, ctx.prio);
    if (!picks.length) {
      bot(p(esc(t("a_none"))), () => opts([{ label: t("a_change_budget"), fn: buyBudget }, { label: t("start_over"), fn: () => start() }]));
      return;
    }
    ctx.picks = picks;
    const intro = p(esc(t("a_picks")));
    const grid = `<div class="pick-grid">${picks.map(pickCard).join("")}</div>`;
    const summary = level === "pro" ? compareHTML(picks) : `<div class="verdict-box">${summaryLines(picks).map(p).join("")}</div>`;
    bot(intro + grid + summary, () => opts([
      ...(level !== "pro" ? [{ label: t("show_table"), fn: () => bot(compareHTML(picks), () => opts(afterPicks())) }] : []),
      ...afterPicks(),
    ]));
  }
  const afterPicks = () => [
    { label: t("see_all"), fn: () => A.goBuy(ctx.use || "any") },
    { label: t("explain_more"), fn: explainMenu },
    { label: t("start_over"), fn: () => start() },
  ];

  // comparison (also used by the Buy page "Compare" sheet)
  function summaryLines(list) {
    const by = (f, dir = 1) => list.slice().sort((a, b) => dir * (f(b) - f(a)))[0];
    const value = by((r) => r.ratio), power = by((r) => r.cpuS + r.gpuS), light = by((r) => -(r.weight || 99)), cheap = by((r) => -r.price);
    const lines = [t("cmp_value", { m: esc(value.model) })];
    if (power !== value) lines.push(t(level === "new" ? "cmp_power_new" : "cmp_power", { m: esc(power.model) }));
    if (light.weight && light !== value && light !== power) lines.push(t("cmp_light", { m: esc(light.model), kg: light.weight }));
    if (cheap !== value) lines.push(t("cmp_cheap", { m: esc(cheap.model), price: money(cheap.price) }));
    return lines;
  }
  function compareHTML(list) {
    if (!list.length) return "";
    const best = (f, low) => { const vals = list.map(f); const b = low ? Math.min(...vals) : Math.max(...vals); return (r) => f(r) === b && list.length > 1 ? "best" : ""; };
    const rowsDef = [
      [t("col_price"), (r) => `<b>${A.rowMoney(r)}</b>`, best((r) => r.price, true)],
      [t("col_value"), (r) => esc(A.verdictLabel(M.verdict(r.ratio))), best((r) => r.ratio)],
      [t("d_cpu"), (r) => `${esc(r.cpu)}<br><small>${r.cpuS}/100</small>`, best((r) => r.cpuS)],
      [t("d_gpu"), (r) => `${esc(A.gpuShort(r.gpu))}<br><small>${r.gpuS}/100</small>`, best((r) => r.gpuS)],
      [t("d_ram"), (r) => `${r.ram} GB`, best((r) => r.ram)],
      [t("d_storage"), (r) => `${A.storageLabel(r.storage)} ${A.ST_LABEL[r.stype]}`, best((r) => r.storage)],
      [t("col_screen"), (r) => A.screenTxt(r), best((r) => r.ppi || 0)],
      [t("col_weight"), (r) => (r.weight ? `${r.weight} kg` : "—"), best((r) => r.weight || 99, true)],
    ];
    return `<div class="cmp-wrap"><table class="cmp-table">
      <thead><tr><th></th>${list.map((r) => `<th>${esc(r.model)}</th>`).join("")}</tr></thead>
      <tbody>${rowsDef.map(([label, cell, cls]) => `<tr><th>${esc(label)}</th>${list.map((r) => `<td class="${cls(r)}">${cell(r)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div><div class="verdict-box">${summaryLines(list).map(p).join("")}</div>`;
  }

  // sell
  function sellHelp() {
    bot(p(esc(t("a_sell"))) + p("• " + esc(t("find_mac"))) + p("• " + esc(t("find_win"))), () => opts([
      { label: t("open_val"), fn: () => { location.hash = "#sell"; } },
      ...backOpts(),
    ]));
  }

  // check a price
  function check() {
    bot(p(esc(t("a_check"))), () => {
      const f = document.createElement("form"); f.className = "check-form";
      f.innerHTML = `<input list="dlModels" name="m" required placeholder="${esc(t("ph_model"))}"><input name="p" type="number" min="10" step="1" required placeholder="${esc(A.curSymbol())}"><button class="btn btn-ink">${esc(t("check_btn"))}</button>`;
      f.onsubmit = (e) => {
        e.preventDefault();
        const m = f.m.value.trim(), price = +f.p.value;
        if (!m || !(price > 0)) return;
        user(`${m} · ${fmt(price)}`);
        checkResult(m, price);
      };
      chat.appendChild(f); scrollDown();
    });
  }
  function checkResult(model, priceDisp) {
    const q = model.toLowerCase();
    let found = A.rows.filter((r) => r.model.toLowerCase() === q);
    if (!found.length) found = A.rows.filter((r) => r.model.toLowerCase().includes(q) || q.includes(r.model.toLowerCase()));
    if (!found.length) { bot(p(esc(t("chk_unknown"))), () => opts([{ label: t("g_check"), fn: check }, ...backOpts()])); return; }
    const fairs = found.map((r) => r.fair).sort((a, b) => a - b);
    const fairUsd = fairs[Math.floor(fairs.length / 2)];
    const ratio = fairUsd / A.toUsd(priceDisp);
    const fair = money(fairUsd);
    const key = ratio >= 1.05 ? "chk_good" : ratio >= 0.92 ? "chk_fair" : "chk_bad";
    const pct = Math.round(Math.abs(1 - 1 / ratio) * 100);
    bot(p(esc(t(key, { p: pct, fair }))) + p(`<small>${esc(t("chk_note"))}</small>`), () => opts([{ label: t("g_check"), fn: check }, ...backOpts()]));
  }

  // explain
  function explainMenu() {
    bot(p(esc(t("a_explain"))), () => opts(TERMS.map((term) => ({ label: t(`gl_${term}_t`), fn: () => explain(term) }))));
  }
  function explain(term) {
    bot(p(`<b>${esc(t(`gl_${term}_t`))}</b>`) + p(esc(t(`gl_${term}_${glossLevel()}`))), () => opts([
      { label: t("explain_more"), fn: explainMenu },
      { label: t("a_goal_short"), fn: () => bot(p(esc(t("a_goal"))), goalMenu) },
    ]));
  }

  // free text: understands terms, intents and a budget number in 5 languages
  const KW = [
    ["ram", /arbeitsspeicher|\bram\b|memor|памят|mémoire/],
    ["cpu", /cpu|process|процессор|prozessor|procesador/],
    ["gpu", /gpu|graphic|видеокарт|gráfic|grafik|graphique|карт/],
    ["storage", /ssd|hdd|storage|накопит|диск|almacen|stockage|festplatte|speicherplatz/],
    ["screen", /screen|display|экран|pantalla|écran|bildschirm|resolu|разреш|auflösung/],
    ["os", /\bos\b|windows|macos|chrome os|операцион|sistema operativo|betriebssystem|système/],
    ["weight", /weight|вес|peso|gewicht|poids|\bkg\b/],
  ];
  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#chatText"); const text = input.value.trim(); if (!text) return;
    input.value = ""; user(text);
    const s = text.toLowerCase();
    const term = KW.find(([, re]) => re.test(s));
    const num = (s.match(/\d[\d\s.,]*/) || [""])[0].replace(/[\s.,]/g, "");
    if (term) return explain(term[0]);
    if (/sell|прода|vend|verkauf/.test(s)) return sellHelp();
    if (/check|fair|честн|justo|fair|prix|preis|precio|цена/.test(s)) return check();
    if (/buy|choose|купить|выбра|compr|kauf|achet|elegir/.test(s) || (num && +num >= 200)) {
      if (!level) { level = "some"; store.set("fs_level", level); }
      if (num && +num >= 200) { ctx.use = ctx.use || "any"; ctx.budget = +num; return buyPrio(); }
      return buyUse();
    }
    bot(p(esc(t("a_fallback"))), goalMenu);
  });
  $("#chatRestart").addEventListener("click", () => start());

  // entry points
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goal]"); if (!g) return;
    pendingGoal = g.dataset.goal;
  });
  let pendingGoal = null;

  window.FairAssist = {
    openTerm, compareHTML,
    onShow() {
      if (pendingGoal) { const g = pendingGoal; pendingGoal = null; start(g); return; }
      if (!started || lastLang !== window.I18N.lang) start();
    },
    rerender() {
      renderTerm();
      if (started && lastLang !== window.I18N.lang && document.body.dataset.view === "ask") start();
    },
  };
  if (document.body.dataset.view === "ask") window.FairAssist.onShow();
})();
