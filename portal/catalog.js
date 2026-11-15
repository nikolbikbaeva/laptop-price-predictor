/* FairSpec verified price catalog.
 *
 * Every row is a real configuration with its price read from the manufacturer's official online store,
 * plus the exact page and the date it was checked. No scraped or estimated prices.
 *
 *  - us: price in USD on the official US store (before sales tax)
 *  - de: price in EUR on the official German store (incl. 19% VAT)
 *  - msrp: the "list"/MSRP shown next to a lower store price, kept for reference (HP lists inflated MSRPs)
 *  - Apple and Microsoft show the same configuration in both stores, so those rows have both prices.
 *
 * Add rows freely; keep one row per configuration. Checked: 2026-11-14.
 */
(function () {
  const CHECKED = "2026-11-14";
  const SRC = {
    appleAirUS: "https://www.apple.com/shop/buy-mac/macbook-air",
    appleAirDE: "https://www.apple.com/de/shop/buy-mac/macbook-air",
    appleProUS: "https://www.apple.com/shop/buy-mac/macbook-pro",
    appleProDE: "https://www.apple.com/de/shop/buy-mac/macbook-pro",
    sl13US: "https://www.microsoft.com/en-us/store/configure/surface-laptop-13-inch-2nd-edition/8wg5vqp0x4bd",
    sl13DE: "https://www.microsoft.com/de-de/store/configure/surface-laptop-13-inch-2nd-edition/8wg5vqp0x4bd",
    sl138US: "https://www.microsoft.com/en-us/store/configure/surface-laptop-13-8-inch-8th-edition/8mzbmmcjzpmf",
    sl138DE: "https://www.microsoft.com/de-de/store/configure/surface-laptop-13-8-inch-8th-edition/8mzbmmcjzpmf",
    sl15US: "https://www.microsoft.com/en-us/store/configure/surface-laptop-15-inch-8th-edition/8mzbmmcjzp9w",
    sl15DE: "https://www.microsoft.com/de-de/store/configure/surface-laptop-15-inch-8th-edition/8mzbmmcjzp9w",
    spUS: "https://www.microsoft.com/en-us/store/configure/surface-pro-13-inch-12th-edition/8mzbmmcjzpmr",
    spDE: "https://www.microsoft.com/de-de/store/configure/surface-pro-13-inch-12th-edition/8mzbmmcjzpmr",
    sluUS: "https://www.microsoft.com/en-us/store/configure/surface-laptop-ultra/8wg5vqp0x4b8",
    sluDE: "https://www.microsoft.com/de-de/store/configure/surface-laptop-ultra/8wg5vqp0x4b8",
    hpHomeUS: "https://www.hp.com/us-en/shop/vwa/laptops/segm=Home",
  };

  // brand, model, cpu, gpu, ramGB, storageGB, inches, [xRes, yRes], weightKg|null, os, prices {us, de, msrp}, sources {us, de}
  const R = [];
  const add = (brand, model, cpu, gpu, ram, storage, inches, res, weight, os, prices, src) =>
    R.push({ brand, model, cpu, gpu, ram, storage, stype: "ssd", inches, xr: res[0], yr: res[1], weight, os, touch: 0, ...prices, src, checked: CHECKED });

  // ---------- Apple (apple.com US + DE, base configurations) ----------
  const air = (inch, res, w) => [inch, res, w];
  add("Apple", "MacBook Air 13 (M5)", "Apple M5 (10-core CPU)", "Apple M5 (8-core GPU)", 16, 512, ...air(13.6, [2560, 1664], 1.23), "macOS", { us: 1299, de: 1399 }, { us: SRC.appleAirUS, de: SRC.appleAirDE });
  add("Apple", "MacBook Air 13 (M5)", "Apple M5 (10-core CPU)", "Apple M5 (10-core GPU)", 16, 512, ...air(13.6, [2560, 1664], 1.23), "macOS", { us: 1399, de: 1509 }, { us: SRC.appleAirUS, de: SRC.appleAirDE });
  add("Apple", "MacBook Air 15 (M5)", "Apple M5 (10-core CPU)", "Apple M5 (10-core GPU)", 16, 512, ...air(15.3, [2880, 1864], 1.51), "macOS", { us: 1499, de: 1699 }, { us: SRC.appleAirUS, de: SRC.appleAirDE });
  add("Apple", "MacBook Pro 14 (M6)", "Apple M6 (12-core CPU)", "Apple M6 (12-core GPU)", 16, 1000, 14.2, [3024, 1964], 1.55, "macOS", { us: 1999, de: 2299 }, { us: SRC.appleProUS, de: SRC.appleProDE });
  add("Apple", "MacBook Pro 14 (M5 Pro)", "Apple M5 Pro (15-core CPU)", "Apple M5 Pro (16-core GPU)", 24, 1000, 14.2, [3024, 1964], 1.6, "macOS", { us: 2499, de: 2899 }, { us: SRC.appleProUS, de: SRC.appleProDE });
  add("Apple", "MacBook Pro 14 (M5 Pro)", "Apple M5 Pro (18-core CPU)", "Apple M5 Pro (20-core GPU)", 24, 1000, 14.2, [3024, 1964], 1.6, "macOS", { us: 2699, de: 3149 }, { us: SRC.appleProUS, de: SRC.appleProDE });
  add("Apple", "MacBook Pro 14 (M5 Max)", "Apple M5 Max (18-core CPU, 32c GPU)", "Apple M5 Max (32-core GPU)", 36, 2000, 14.2, [3024, 1964], 1.62, "macOS", { us: 4099, de: 4799 }, { us: SRC.appleProUS, de: SRC.appleProDE });
  add("Apple", "MacBook Pro 16 (M5 Pro)", "Apple M5 Pro (18-core CPU)", "Apple M5 Pro (20-core GPU)", 24, 1000, 16.2, [3456, 2234], 2.14, "macOS", { us: 2999, de: 3399 }, { us: SRC.appleProUS, de: SRC.appleProDE });
  add("Apple", "MacBook Pro 16 (M5 Max)", "Apple M5 Max (18-core CPU, 32c GPU)", "Apple M5 Max (32-core GPU)", 36, 2000, 16.2, [3456, 2234], 2.15, "macOS", { us: 4399, de: 5099 }, { us: SRC.appleProUS, de: SRC.appleProDE });

  // ---------- Microsoft Surface (microsoft.com US + DE, full list prices) ----------
  const ms = (model, cpu, gpu, ram, sto, inch, res, w, us, de, s) => add("Microsoft", model, cpu, gpu, ram, sto, inch, res, w, "Windows", { us, de }, { us: SRC[s + "US"], de: SRC[s + "DE"] });
  const X2P10 = "Snapdragon X2 Plus (10-core)", X2P6 = "Snapdragon X2 Plus (6-core)", X2E = "Snapdragon X2 Elite (12-core)", ADR = "Qualcomm Adreno (X2)";
  ms("Surface Laptop 13 (2nd Ed.)", X2P6, ADR, 16, 256, 13, [1920, 1280], 1.2, 1199.99, 1319, "sl13");
  ms("Surface Laptop 13 (2nd Ed.)", X2P6, ADR, 16, 512, 13, [1920, 1280], 1.2, 1299.99, 1439, "sl13");
  ms("Surface Laptop 13 (2nd Ed.)", X2P6, ADR, 24, 512, 13, [1920, 1280], 1.2, 1499.99, 1679, "sl13");
  ms("Surface Laptop 13.8 (8th Ed.)", X2P10, ADR, 16, 512, 13.8, [2304, 1536], 1.34, 1599.99, 1699, "sl138");
  ms("Surface Laptop 13.8 (8th Ed.)", X2E, ADR, 16, 512, 13.8, [2304, 1536], 1.34, 1699.99, 1799, "sl138");
  ms("Surface Laptop 13.8 (8th Ed.)", X2E, ADR, 16, 1000, 13.8, [2304, 1536], 1.34, 1999.99, 2099, "sl138");
  ms("Surface Laptop 13.8 (8th Ed.)", X2E, ADR, 32, 1000, 13.8, [2304, 1536], 1.34, 2649.99, 2749, "sl138");
  ms("Surface Laptop 15 (8th Ed.)", X2P10, ADR, 16, 512, 15, [2496, 1664], 1.66, 1699.99, 1799, "sl15");
  ms("Surface Laptop 15 (8th Ed.)", X2E, ADR, 16, 512, 15, [2496, 1664], 1.66, 1799.99, 1899, "sl15");
  ms("Surface Laptop 15 (8th Ed.)", X2E, ADR, 16, 1000, 15, [2496, 1664], 1.66, 2199.99, 2299, "sl15");
  ms("Surface Laptop 15 (8th Ed.)", X2E, ADR, 24, 512, 15, [2496, 1664], 1.66, 2249.99, 2399, "sl15");
  ms("Surface Laptop 15 (8th Ed.)", X2E, ADR, 32, 1000, 15, [2496, 1664], 1.66, 2849.99, 2949, "sl15");
  ms("Surface Laptop 15 (8th Ed.)", X2E, ADR, 64, 1000, 15, [2496, 1664], 1.66, 3649.99, 3799, "sl15");
  ms("Surface Pro 13 (12th Ed.)", X2P10, ADR, 16, 256, 13, [2880, 1920], 0.9, 1499.99, 1599, "sp");
  ms("Surface Pro 13 (12th Ed.)", X2P10, ADR, 16, 512, 13, [2880, 1920], 0.9, 1599.99, 1699, "sp");
  ms("Surface Pro 13 (12th Ed.)", X2E, ADR, 16, 512, 13, [2880, 1920], 0.9, 1799.99, 1899, "sp");
  ms("Surface Pro 13 (12th Ed.)", X2E, ADR, 16, 1000, 13, [2880, 1920], 0.9, 2099.99, 2199, "sp");
  ms("Surface Pro 13 (12th Ed.)", X2E, ADR, 24, 512, 13, [2880, 1920], 0.9, 2249.99, 2399, "sp");
  ms("Surface Pro 13 (12th Ed.)", X2E, ADR, 32, 1000, 13, [2880, 1920], 0.9, 2749.99, 2849, "sp");
  ms("Surface Pro 13 (12th Ed.)", X2E, ADR, 64, 1000, 13, [2880, 1920], 0.9, 3549.99, 3699, "sp");
  const N1X18 = "NVIDIA RTX Spark N1X (18-core CPU)", N1X20 = "NVIDIA RTX Spark N1X (20-core CPU)", SP5 = "NVIDIA RTX Spark (5120-core GPU)", SP6 = "NVIDIA RTX Spark (6144-core GPU)";
  ms("Surface Laptop Ultra", N1X18, SP5, 24, 512, 15, [3000, 2000], null, 2599.99, 2899, "slu");
  ms("Surface Laptop Ultra", N1X18, SP5, 24, 1000, 15, [3000, 2000], null, 2999.99, 3399, "slu");
  ms("Surface Laptop Ultra", N1X18, SP5, 32, 1000, 15, [3000, 2000], null, 3299.99, 3759, "slu");
  ms("Surface Laptop Ultra", N1X20, SP6, 32, 1000, 15, [3000, 2000], null, 3699.99, 4239, "slu");
  ms("Surface Laptop Ultra", N1X20, SP6, 64, 1000, 15, [3000, 2000], null, 4299.99, 4959, "slu");
  ms("Surface Laptop Ultra", N1X20, SP6, 64, 2000, 15, [3000, 2000], null, 4699.99, 5439, "slu");
  ms("Surface Laptop Ultra", N1X20, SP6, 128, 1000, 15, [3000, 2000], null, 5899.99, 6879, "slu");

  // ---------- HP (hp.com US home laptops; "us" = price charged on hp.com, "msrp" = HP's list price) ----------
  const hp = (model, cpu, gpu, ram, sto, inch, res, us, msrp) => add(/^(OMEN|HyperX)/.test(model) ? "HP" : "HP", model, cpu, gpu, ram, sto, inch, res, null, "Windows", { us, msrp }, { us: SRC.hpHomeUS });
  hp("HP OmniBook X 14 (RTX Spark)", N1X18, SP5, 32, 1000, 14, [2880, 1800], 2499.99, 2999.99);
  hp("HP OmniBook Ultra 16 (RTX Spark)", N1X18, SP5, 32, 1000, 16, [2880, 1800], 2699.99, 3199.99);
  hp("HP OmniBook 3 17 (17t-dg000)", "Intel Core 5 315", "Intel Graphics", 8, 256, 17.3, [1600, 900], 479.99, 999.99);
  hp("HP OmniBook 7 17 (17t-dc000)", "Intel Core Ultra 7 256V", "Intel Arc 140V", 16, 512, 17.3, [1920, 1080], 879.99, 1529.99);
  hp("HP OmniBook 3 16 (16T-BU000)", "Intel N150", "Intel Graphics", 4, 256, 16, [1920, 1200], 349.99, 799.99);
  hp("HP 15 AI (15t-fd200)", "Intel Core Ultra 5 225U", "Intel Graphics", 8, 256, 15.6, [1366, 768], 549.99, 1099.99);
  hp("HP 15 (15t-fd100)", "Intel Core 7 150U", "Intel Graphics", 8, 256, 15.6, [1366, 768], 629.99, 1079.99);
  hp("HP OmniBook 3 17 (17t-dk000)", "Intel Core 5 120U", "Intel Graphics", 8, 256, 17.3, [1600, 900], 599.99, 1049.99);
  hp("HP OmniBook 5 Flip 14 (14-fp0000)", "Intel Core 3 100U", "Intel Graphics", 8, 256, 14, [1920, 1200], 559.99, 999.99);
  hp("HP OmniBook X 17 (17t-dd000)", "Intel Core Ultra 7 256V", "Intel Arc 140V", 16, 512, 17.3, [1920, 1080], 1079.99, 1369.99);
  hp("HP OmniBook 3 17 (17T-DF000)", "Intel Core Ultra 5 325", "Intel Graphics", 16, 256, 17.3, [1600, 900], 759.99, 1199.99);
  hp("HP OmniBook 7 Flip 16 (16-au0047nr)", "Intel Core Ultra 7", "Intel Graphics", 16, 1000, 16, [2880, 1800], 1849.99);
  hp("HP OmniBook 7 14 (14T-HG000)", "Intel Core Ultra 5 325", "Intel Graphics", 16, 512, 14, [1920, 1200], 999.99, 1479.99);
  hp("HP OmniBook 7 Flip 16 (16t-au000)", "Intel Core Ultra 7 256V", "Intel Arc 140V", 16, 512, 16, [1920, 1200], 999.99, 1599.99);
  hp("HP OmniBook 5 14 OLED (14-he000)", "Snapdragon X X1-26-100", "Qualcomm Adreno", 16, 512, 14, [1920, 1200], 849.99, 1319.99);
  hp("HP OmniBook 7 16 (16T-BH000)", "Intel Core Ultra 7 356H", "Intel Graphics", 24, 512, 16, [1920, 1200], 1229.99, 1999.99);
  hp("HP OmniBook X Flip 16 (16z-cc000)", "AMD Ryzen AI 5 430", "AMD Radeon 840M", 16, 512, 16, [1920, 1200], 999.99, 1499.99);
  hp("HP OmniBook 5 14 OLED (14T-HH000)", "Intel Core Ultra 5 322", "Intel Graphics", 16, 256, 14, [1920, 1200], 849.99, 1299.99);
  hp("HP OmniBook Ultra 14 (14-kg000)", "Snapdragon X2 Plus (10-core)", "Qualcomm Adreno (X2)", 16, 512, 14, [1920, 1200], 1299.99, 1899.99);
  hp("HP OmniBook X 17 (17t-de000)", "Intel Core Ultra 5 325", "Intel Graphics", 16, 512, 17.3, [1920, 1080], 1149.99, 1499.99);
  hp("OMEN Gaming 16 (16-ap0097nr)", "AMD Ryzen AI 9", "NVIDIA GeForce RTX 5070 (Laptop)", 32, 1000, 16, [2560, 1600], 2899.99);
  hp("HP OmniBook 7 AI 16 (16-ay0087nr)", "Intel Core Ultra 7", "NVIDIA GeForce RTX 4050 (Laptop)", 16, 1000, 16, [1920, 1200], 2099.99);
  hp("HP OmniBook X Flip 16 (16t-cb000)", "Intel Core Ultra 5 325", "Intel Graphics", 16, 512, 16, [1920, 1200], 1049.99, 1499.99);
  hp("HyperX OMEN 15 (15-gb0000)", "AMD Ryzen 5 240", "NVIDIA GeForce RTX 5050 (Laptop)", 8, 512, 15.3, [1920, 1200], 1249.99, 1599.99);
  hp("HP OmniBook X 17 RTX (17-dd0057nr)", "Intel Core Ultra 7", "NVIDIA GeForce RTX 4050 (Laptop)", 16, 1000, 17.3, [1920, 1080], 1549.99);
  hp("HP OmniBook 3 14 (14-HZ000)", "Snapdragon X X1-26-100", "Qualcomm Adreno", 16, 256, 14, [1920, 1200], 699.99, 1309.99);
  hp("HP OmniBook 5 16 (16-af1037nr)", "Intel Core Ultra 7", "Intel Graphics", 16, 512, 16, [1920, 1200], 1599.99);
  hp("HP OmniBook 3 17 (17z-dn000)", "AMD Ryzen 5 230", "AMD Radeon 760M", 8, 256, 17.3, [1600, 900], 579.99, 949.99);
  hp("HP OmniBook Ultra 14 (14t-kd000)", "Intel Core Ultra 7 356H", "Intel Graphics", 16, 512, 14, [2880, 1800], 1319.99, 1819.99);
  hp("HP OmniBook X Flip 14 (14z-kc000)", "AMD Ryzen AI 5 430", "AMD Radeon 840M", 16, 512, 14, [1920, 1200], 949.99, 1339.99);
  hp("HP OmniBook 5 14 OLED (14t-kf000)", "Intel Core 5 320", "Intel Graphics", 16, 256, 14, [1920, 1200], 749.99, 1229.99);
  hp("HP OmniBook X Flip 14 (14-fm0047nr)", "Intel Core Ultra 7", "Intel Graphics", 16, 512, 14, [1920, 1200], 1599.99);
  hp("HyperX OMEN 15 (15-ga0100)", "Intel Core Ultra 7 356H", "NVIDIA GeForce RTX 5050 (Laptop)", 16, 512, 15.3, [1920, 1200], 1549.99, 1999.99);
  hp("HP OmniBook 3 16 (16-CT000)", "Snapdragon C (C1-10-100)", "Qualcomm Adreno", 4, 256, 16, [1920, 1200], 699.99);
  hp("HP OmniBook X Flip 16 (16t-as000)", "Intel Core Ultra 7 256V", "Intel Arc 140V", 16, 512, 16, [1920, 1200], 1139.99, 1469.99);
  hp("HP OmniBook X 14 (14t-ka000)", "Intel Core Ultra 5 325", "Intel Graphics", 16, 512, 14, [1920, 1200], 1099.99, 1439.99);

  // ---------- Lenovo (lenovo.com US; "us" = price charged on lenovo.com during the Nov 2026 sale, "msrp" = Lenovo "Est. Value") ----------
  // Lenovo's catalog tiles don't list the screen resolution, so it is left unknown (null) rather than guessed.
  const LEN = "https://www.lenovo.com/us/en/laptops/results/";
  const lv = (model, cpu, gpu, ram, sto, inch, us, msrp, os = "Windows", stype = "ssd") => { add("Lenovo", model, cpu, gpu, ram, sto, inch, [null, null], null, os, { us, msrp }, { us: LEN }); R[R.length - 1].stype = stype; };
  lv("Chromebook Duet Gen 9 (11\")", "MediaTek Kompanio 838", "ARM Mali-G57 MC3", 8, 128, 11, 399.99, 629.99, "Chrome OS", "emmc");
  lv("Chromebook Duet Gen 9 (11\")", "MediaTek Kompanio 838", "ARM Mali-G57 MC3", 4, 64, 11, 319.99, 499.99, "Chrome OS", "emmc");
  lv("Lenovo Chromebook m (14\")", "MediaTek Kompanio 540", "ARM Mali-G57 MC2", 4, 64, 14, 299.99, 429.99, "Chrome OS", "emmc");
  lv("Lenovo Chromebook m (15\")", "MediaTek Kompanio 540", "ARM Mali-G57 MC2", 4, 128, 15.6, 349.99, 519.99, "Chrome OS", "emmc");
  lv("Chromebook Plus 2-in-1 (14\" Intel)", "Intel Core 3 N355", "Intel Graphics", 8, 128, 14, 529.99, 799.99, "Chrome OS", "emmc");
  lv("Lenovo Chromebook Plus i (15\" Intel)", "Intel Core 3 N355", "Intel Graphics", 8, 256, 15.6, 629.99, 849.99, "Chrome OS");
  lv("ThinkBook 14x Intel (14\")", "Intel Core Ultra 7 256V", "Intel Arc 140V", 16, 512, 14, 949, 1449);
  lv("ThinkBook 14x Intel (14\")", "Intel Core Ultra 5 226V", "Intel Arc 130V", 16, 256, 14, 699, 1119);
  lv("Yoga 7 2-in-1 (16\" AMD)", "AMD Ryzen AI 5 340", "AMD Radeon 840M", 16, 1000, 16, 849.99, 1399.99);
  lv("ThinkPad E14 Gen 7 Intel (14\")", "Intel Core 7 240H", "Intel Graphics", 16, 512, 14, 1249, 1699);
  lv("ThinkPad P14s Gen 7 Intel (14\")", "Intel Core Ultra 7 356H", "NVIDIA RTX PRO 500 Blackwell", 32, 1000, 14, 2679, 3839);
  lv("Legion Pro 5i Gen 10 (16\") RTX 5060", "Intel Core Ultra 7 251HX", "NVIDIA GeForce RTX 5060 (Laptop)", 16, 1000, 16, 1649.99, 2666.99);
  lv("ThinkPad L14 Gen 7 Intel (14\")", "Intel Core Ultra 7 355", "Intel Graphics", 16, 512, 14, 1399, 1819);
  lv("ThinkBook 14 Gen 9 Intel (14\")", "Intel Core 7 240H", "Intel Graphics", 16, 512, 14, 1199, 1539);
  lv("IdeaPad 5i 2-in-1 (14\" Intel)", "Intel Core Ultra 5 322", "Intel Graphics", 16, 1000, 14, 749.99, 1299.99);
  lv("IdeaPad Slim 3 (15\" AMD)", "AMD Ryzen 5 8540U", "AMD Radeon 740M", 8, 512, 15.6, 539.99, 749.99);
  lv("IdeaPad Slim 3i (15\" Intel)", "Intel Core 3 100U", "Intel Graphics", 8, 512, 15.6, 619.99, 899.99);
  lv("IdeaPad Slim 3x (15\" Snapdragon)", "Snapdragon X X1-26-100", "Qualcomm Adreno", 16, 512, 15.6, 699.99, 1199.99);

  window.CATALOG = { rows: R, checked: CHECKED, sources: SRC };
})();
