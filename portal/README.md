# FairSpec — the website

Live: https://fairspec-fairspec.vercel.app

A static website (HTML, CSS, JavaScript — no build step) with:

- **Buy** — filter laptops by budget and use; each gets a *great deal / fair / overpriced* label.
- **Sell** — a fair price and a likely range for a used laptop (age + condition).
- **Compare** up to 4 laptops, an **assistant** that explains specs in plain words.
- 5 languages (EN, ES, RU, DE, FR) and prices in USD / EUR / GBP with each country's VAT.
- **Demo marketplace** — laptop profiles, card checkout (test card `4242 4242 4242 4242`), seller chat. No real payments.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```bash
cd portal
python -m http.server 8765
```

Then open http://localhost:8765.

## Files

- `index.html`, `styles.css` — page and design.
- `app.js` — the app (pages, filters, demo marketplace).
- `model.js`, `catalog.js` — the pricing model and the laptop catalog.
- `assistant.js`, `hero3d.js` — the assistant and the 3D laptop.
- `i18n.js`, `i18n-more.js` — translations.
- `config.js` — Supabase project URL and **publishable** key (safe to share; the data is protected by row-level security). Never put a secret / service_role key here.
- `supabase/*.sql` — database tables and security rules.
