(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const USE_GOOGLE = !!CFG.googleApiKey;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.round(n).toLocaleString("ja-JP");
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem("shutten." + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem("shutten." + k, JSON.stringify(v)); } catch (e) {} },
  };

  let cur = null;      // { lat, lon, matched, address, cells, comps }
  let active = -1;

  // ---------------------------------------------------------------- 計算
  function distKm(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180, dlat = (lat2 - lat1) * r, dlon = (lon2 - lon1) * r;
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dlon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }
  function meshBox(code) {
    code = String(code);
    const p = +code.slice(0, 2), u = +code.slice(2, 4), q = +code[4], v = +code[5], r = +code[6], w = +code[7], m = +code[8] - 1;
    return { s: p / 1.5 + q / 12 + r / 120 + Math.floor(m / 2) / 240, w: u + 100 + v / 8 + w / 80 + (m % 2) / 160, dl: 1 / 240, dn: 1 / 160 };
  }
  function primaryCodes(lat, lon, km) {
    const dlat = km / 111, dlon = km / (111 * Math.cos(lat * Math.PI / 180)), set = new Set();
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const la = lat - dlat + 2 * dlat * i / 6, lo = lon - dlon + 2 * dlon * j / 6;
      set.add(`${Math.floor(la * 1.5)}${Math.floor(lo - 100)}`);
    }
    return [...set];
  }
  const meshCache = {};
  async function loadMesh(code) {
    if (!(code in meshCache)) {
      meshCache[code] = fetch(`data/mesh/${code}.json`).then((r) => (r.ok ? r.json() : { m: [] })).catch(() => ({ m: [] }));
    }
    return meshCache[code];
  }
  async function buildCells(lat, lon) {
    const maxKm = 10.5, N = 8, cells = [];
    const sets = await Promise.all(primaryCodes(lat, lon, maxKm).map(loadMesh));
    const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57;
    for (const set of sets) for (const row of set.m) {
      const b = meshBox(row[0]);
      const x0 = (b.w - lon) * kx, y0 = (b.s - lat) * ky, wx = b.dn * kx, hy = b.dl * ky;
      if (Math.hypot(x0 + wx / 2, y0 + hy / 2) > maxKm + 0.5) continue;
      const d = [], xy = [];
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const x = x0 + wx * (j + 0.5) / N, y = y0 + hy * (i + 0.5) / N;
        d.push(Math.hypot(x, y)); xy.push(x, y);
      }
      cells.push({ d, xy, v: row.slice(1) });
    }
    return cells;
  }
  // 中心から rIn より外、rOut 以内（rIn=0 なら円の中すべて）の人口・世帯を数える
  function sumWithin(rOut, rIn = 0) {
    const t = [0, 0, 0, 0, 0];
    for (const c of cur.cells) {
      let n = 0; for (const d of c.d) if (d > rIn && d <= rOut) n++;
      if (!n) continue;
      const f = n / c.d.length;
      for (let k = 0; k < 5; k++) t[k] += c.v[k] * f;
    }
    return { pop: t[0], hh: t[1], single: t[2], kids: t[3], senior: t[4] };
  }
  // ---------------------------------------------------------------- 売上の見込み（直営店の実績ベース）
  // ランドリープレス直営店（開業2年以上）の売上実績から求めた目安。
  // 直営店では、世帯数・他社の数・広さ・台数などで売上の差はほとんど説明できなかったため、
  // 「直営店と似た条件の場所なら、直営店と同じくらい売れる」という考え方で出している。
  const REF = {
    low: 1100000, high: 1700000,    // 直営店の大半が入る幅
    ramp: [0.8, 0.92],              // 開業1年目・2年目は3年目の約80%・約92%
    // 直営店の条件の範囲（候補地を中心にした円の中の数）
    hh1: [4000, 45000],             // 1km以内の世帯数
    hh2: [10000, 161000],           // 2km以内の世帯数
    comp1: 23,                      // 1km以内の他社の数（これより多い直営店はない）
  };
  const PARAM_DEF = [["price", "客単価", "円", 900, 50]];
  const PARAM0 = Object.fromEntries(PARAM_DEF.map((d) => [d[0], d[3]]));
  let P = { ...PARAM0, ...(store.get("params") || {}) };

  // 直営店と似た条件かどうかを3つの点で調べる（商圏の設定に関係なく1km・2kmで見る）
  function conditions() {
    const s1 = sumWithin(1), h1 = s1.hh, h2 = sumWithin(2).hh;
    const c1 = cur.comps.filter((c) => c.km <= 1 && !c.closed).length;
    const range = (v, [lo, hi]) => (v < lo ? -1 : v > hi ? 1 : 0);
    return [
      { label: "1km以内の世帯数", value: `${fmt(h1)}世帯`, pos: range(h1, REF.hh1),
        low: "直営店のどの店より少なめです", high: "直営店のどの店より多めです" },
      { label: "2km以内の世帯数", value: `${fmt(h2)}世帯`, pos: range(h2, REF.hh2),
        low: "直営店のどの店より少なめです", high: "直営店のどの店より多めです" },
      { label: "1km以内の他社", value: `${c1}店`, pos: c1 > REF.comp1 ? 1 : 0,
        high: "直営店のどの店より多めです" },
      // マンションが多い地域（1km以内の単身世帯が5割以上）は1段階上げる（2026-11-08 直営店14店の答え合わせから）
      { label: "1km以内の単身世帯の割合", value: `${Math.round(s1.single / Math.max(1, s1.hh) * 100)}%`, pos: 0, extra: true,
        up: s1.single / Math.max(1, s1.hh) >= APT_RATIO },
    ];
  }
  function estimate() {
    const cond = conditions(), out = cond.filter((c) => !c.extra && c.pos !== 0).length, apt = cond.some((c) => c.extra && c.up);
    // 世帯数が直営店のどの店より少ない場所は、売上が伸びにくいおそれ（世帯がいちばん少ない直営店は100万円未満）
    const fewHH = cond.slice(0, 2).some((c) => c.pos < 0);
    const base = fewHH || out >= 2 ? 2 : out === 1 ? 1 : 0;
    const pt = specScore(), roadNG = S.road === 1 && !roadOK();
    // 商圏の判定で出発点の金額帯を決め、お店の条件4点ごとに1つ上下させる（2026-11-08 直営店14店の答え合わせで、お店側の点を半分の重みに）
    const band0 = BASE_BAND[base] + (apt ? 1 : 0);
    let band = Math.min(BANDS.length - 1, Math.max(0, band0 + Math.trunc(pt / STEP_PT)));
    if (roadNG) band = Math.min(band, 3);
    const grade = gradeOf(band);
    const [lo, hi] = BANDS[band];
    return { cond, base, pt, roadNG, grade, band, band0, lo, hi, sales: lo,
      dayLo: lo / P.price / 30, dayHi: hi ? hi / P.price / 30 : null };
  }
  // 月の売上の金額帯（円）。◎=120万円以上、○=100〜120万円、△=100万円未満
  const BANDS = [[0, 400000], [400000, 600000], [600000, 800000], [800000, 1000000], [1000000, 1200000], [1200000, 1400000], [1400000, 1600000], [1600000, null]];
  const BASE_BAND = [5, 4, 3];   // 商圏だけで見たときの基準（直営店と似た商圏→120〜140万、1つ外れる→100〜120万、それ以外→80〜100万）。マンションが多い地域は＋1段階
  const APT_RATIO = 0.5;
  const STEP_PT = 4;             // お店の条件 4点で1段階
  const bandTxt = (b) => { const [lo, hi] = BANDS[b]; return !lo ? `${hi / 1e4}万円未満` : !hi ? `${lo / 1e4}万円以上` : `${lo / 1e4}〜${hi / 1e4}万円`; };
  // マーク: ★=120万円以上、◎=100万円以上、○=80万円以上、△=80万円未満（2026-11 Yuta指定）
  const GRADES = [["★", "月120万円以上が見込めます", "g0"], ["◎", "月100万円以上が見込めます", "g0"], ["○", "月80〜100万円の見込み", "g1"], ["△", "月80万円に届かないおそれ", "g2"]];
  const SALES_TXT = ["120万円以上", "100万円以上", "80〜100万円", "80万円未満のおそれ"];
  const gradeOf = (band) => (band >= 5 ? 0 : band === 4 ? 1 : band === 3 ? 2 : 3);

  // ---------------------------------------------------------------- お店の条件（点数）
  // 道・駐車場・広さ・台数・近くの集客施設を点数にして、商圏からの判定を上げ下げする。
  // 点数の配分は社内の考え方（生活道路沿いが良い、幹線道路は条件つき）をもとにした目安。
  // 基準（直営店の標準的なつくり）を0点とし、良ければプラス、悪ければマイナス（2026-11 社内基準）
  const SPEC_DEF = [
    { k: "road", label: "道", base: 0, opts: [["生活道路沿い", 0], ["幹線道路沿い", -2]] },
    { k: "lanes", label: "前の道の車線", base: 0, opts: [["片側1車線", 0], ["片側2車線以上", -1]] },
    { k: "access", label: "反対車線からの出入り", base: 0, opts: [["しやすい", 0], ["しにくい", -1]] },
    { k: "speed", label: "前の道のスピード", base: 0, opts: [["出にくい（ゆっくり走る道）", 0], ["出やすい", -1]] },
    { k: "park", label: "駐車場", base: 2, opts: [["なし", -2], ["1〜3台", -1], ["4〜5台", 0], ["6〜8台", 1], ["9〜10台", 2], ["11台以上", 3]] },
    { k: "tsubo", label: "広さ", base: 4, opts: [["10坪以下", -4], ["10〜15坪", -3], ["15〜20坪", -2], ["20〜25坪", -1], ["25〜30坪", 0], ["30〜35坪", 1], ["35坪以上", 2]] },
    { k: "wd", label: "洗濯乾燥機", base: 2, opts: [["2台以下", -2], ["3台", -1], ["4台", 0], ["5台", 1], ["6台以上", 2]] },
    { k: "dry", label: "乾燥機", base: 2, opts: [["2台以下", -2], ["3台", -1], ["4台", 0], ["5台", 0]] },
    { k: "near", label: "300m以内のスーパー・ドラッグストア", base: 1, opts: [["ない", -1], ["ある", 0]] },
    { k: "see", label: "お店の見えやすさ（角地・看板）", base: 1, opts: [["見つけにくい", -1], ["ふつう", 0], ["よく見える", 1]] },
    { k: "rival", label: "500m以内に競合店（大型店や新しい店舗）", base: 0, opts: [["ない", 0], ["ある", -6]] },
    { k: "parkEase", label: "駐車場の止めやすさ", base: 1, opts: [["止めにくい", -1], ["ふつう", 0], ["止めやすい（道から直接入れる）", 1]] },
    { k: "big", label: "大型洗濯機（布団が洗える）", base: 1, opts: [["ない", -1], ["ある", 0]] },
    { k: "clean", label: "クリーニング併設", base: 1, opts: [["なし", -1], ["併設", 0]] },
    { k: "night", label: "夜の明るさ・入りやすさ", base: 1, opts: [["暗い・入りにくい", -1], ["明るく入りやすい", 0]] },
  ];
  // 参考チェック（2026-11-09 Yuta希望で追加）。まだ点数には入れない。直営店で答え合わせして効いたものだけ点数にする
  const CHECK_DEF = [
    { k: "night", label: "夜も人が来る立地（駅・飲食店・病院・工場の近く、夜勤の人が多い）" },
    { k: "route", label: "スーパーや駅に行く途中の、生活の通り道にある" },
    { k: "split", label: "商圏が川・線路・大きな道路で分断されている", bad: true },
    { k: "weakRival", label: "近くの競合店は古い・小さい・汚い店ばかり" },
    { k: "rivalBig", label: "近くの競合店に布団が洗える大型洗濯機がある", bad: true },
    { k: "growing", label: "新しいマンションや住宅地が増えている" },
    { k: "glass", label: "店内が外から見える（ガラス張り・明るい）" },
    { k: "cashless", label: "キャッシュレス・アプリで払える" },
    { k: "h24", label: "24時間営業" },
  ];
  const CHECK_OPTS = ["わからない", "はい", "いいえ"];
  let CK = { ...(store.get("check1") || {}) };
  const ROAD_OK = [["median", "中央分離帯がない"], ["inout", "反対車線から入りやすく、出やすい"], ["seeOpp", "反対車線から見えやすい"]];
  const SPEC0 = { ...Object.fromEntries(SPEC_DEF.map((d) => [d.k, d.base])), inout: false, seeOpp: false, median: false };
  let S = { ...SPEC0, ...(store.get("spec4") || {}) };
  // 幹線道路沿いは3つの条件が必須（そろわなければ80〜100万円まで）
  const roadOK = () => ROAD_OK.every(([k]) => S[k]);
  // 500m以内に7,000世帯以上ある街中では、歩き・自転車のお客さんが多いため駐車場が少なくても減点しない（直営店の実績より）
  const CITY_HH = 7000;
  const isCity = () => !!cur && sumWithin(0.5).hh >= CITY_HH;
  const specPt = (d) => { const v = d.opts[S[d.k]][1]; return d.k === "park" && v < 0 && isCity() ? 0 : v; };
  const specScore = () => SPEC_DEF.reduce((a, d) => a + specPt(d), 0);
  const signed = (v) => (v > 0 ? "+" + v : v < 0 ? "−" + -v : "±0");
  const man = (yen) => (yen / 1e4 >= 100 ? fmt(yen / 1e4) : (Math.round(yen / 1e3) / 10).toLocaleString("ja-JP"));

  const radii = () => [
    Math.min(10, Math.max(0.25, +$("#r1").value || CFG.r1 || 1)),
    Math.min(10, Math.max(0.25, +$("#r2").value || CFG.r2 || 2)),
  ];

  // ---------------------------------------------------------------- 住所検索（国土地理院）
  async function geocode(addr) {
    const r = await fetch("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(addr));
    const j = await r.json();
    if (!j.length) throw new Error("住所が見つかりませんでした。都道府県から入力してみてください。");
    const [lon, lat] = j[0].geometry.coordinates;
    return { lat, lon, matched: j[0].properties.title };
  }

  // ---------------------------------------------------------------- 他社店舗
  const CLEANING_NAME = /クリーニング|ｸﾘｰﾆﾝｸﾞ|cleaning|ドライ|白洋舎|ホワイト急便|うさちゃん|ポニー/i;
  const LAUNDRY_NAME = /ランドリー|らんどりー|laundry|wash|ウォッシュ|ウオッシュ|コイン|洗濯|ざぶざぶ|アクア/i;

  async function compsGoogle(lat, lon, rKm) {
    const { Place } = await google.maps.importLibrary("places");
    // 半径に応じて範囲を分け、1回20件の上限で取りこぼさないようにする
    const n = rKm <= 2 ? 1 : rKm <= 5 ? 2 : 3;
    const dlat = rKm / 110.57, dlon = rKm / (111.32 * Math.cos(lat * Math.PI / 180));
    // 2通りで探す: ①「コインランドリー」で検索 ②Googleが「ランドリー」に分類しているお店（店名は問わない）
    const queries = [
      { textQuery: "コインランドリー" },
      { textQuery: "コインランドリー 洗濯 乾燥", includedType: "laundry", useStrictTypeFiltering: true },
    ];
    const jobs = [];
    for (const q of queries) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const s = lat - dlat + 2 * dlat * i / n, w = lon - dlon + 2 * dlon * j / n;
      jobs.push(Place.searchByText({
        ...q,
        fields: ["id", "displayName", "formattedAddress", "location", "businessStatus", "googleMapsURI", "photos"],
        locationRestriction: { south: s, west: w, north: s + 2 * dlat / n, east: w + 2 * dlon / n },
        maxResultCount: 20, language: "ja", region: "jp",
      }).then((r) => r.places).catch(() => []));
    }
    const lists = await Promise.all(jobs);
    const full = lists.some((l) => l.length >= 20);
    const seen = new Map();
    let excluded = 0;
    for (const p of lists.flat()) {
      if (seen.has(p.id) || p.businessStatus === "CLOSED_PERMANENTLY") continue;
      const name = p.displayName || "";
      // 店名にランドリー等が無く「クリーニング」だけの店は、クリーニング専門店とみなして除く
      const named = LAUNDRY_NAME.test(name);
      if (!named && CLEANING_NAME.test(name)) { excluded++; seen.set(p.id, null); continue; }
      const la = p.location.lat(), lo = p.location.lng();
      seen.set(p.id, {
        name, address: (p.formattedAddress || "").replace(/^日本、(〒\d{3}-\d{4} )?/, ""),
        lat: la, lon: lo, km: distKm(lat, lon, la, lo), url: p.googleMapsURI,
        closed: p.businessStatus === "CLOSED_TEMPORARILY", unsure: !named,
        photo: p.photos && p.photos[0] ? {
          // 写真は印刷するときだけ読み込む（読み込むたびに料金がかかるため）
          src: () => p.photos[0].getURI({ maxWidth: 640 }),
          by: (p.photos[0].authorAttributions || []).map((a) => a.displayName).filter(Boolean).join("、"),
        } : null,
      });
    }
    const comps = [...seen.values()].filter(Boolean).filter((c) => c.km <= rKm * 1.42);
    let note = "Googleマップで「コインランドリー」を検索した結果と、Googleがランドリーに分類しているお店です。";
    if (comps.some((c) => c.unsure)) note += "店名にランドリー等が入っていないお店には「要確認」と付けています。";
    if (excluded) note += `店名が「クリーニング」だけのお店${excluded}件は除いています。`;
    if (full) note += "店が多い地域のため、一部の店が出ていない可能性があります。";
    return { comps, note };
  }

  async function nearShops(lat, lon) {
    let list = [];
    if (USE_GOOGLE) {
      const { Place } = await google.maps.importLibrary("places");
      const r = await Place.searchNearby({
        fields: ["displayName", "location"], includedTypes: ["supermarket", "drugstore", "pharmacy"],
        locationRestriction: { center: { lat, lng: lon }, radius: 300 }, maxResultCount: 5, rankPreference: "DISTANCE", language: "ja", region: "jp",
      });
      list = (r.places || []).map((p) => ({ name: p.displayName, km: distKm(lat, lon, p.location.lat(), p.location.lng()) }));
    } else {
      const q = `[out:json][timeout:15];nwr["shop"~"^(supermarket|chemist)$"](around:300,${lat},${lon});out center tags;`;
      const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q) });
      const j = await r.json();
      list = j.elements.filter((e) => e.tags && /supermarket|chemist/.test(e.tags.shop || "")).map((e) => {
        const la = e.lat ?? e.center.lat, lo = e.lon ?? e.center.lon;
        return { name: e.tags.name || "スーパー・ドラッグストア", km: distKm(lat, lon, la, lo) };
      });
    }
    list = list.filter((x) => x.km <= 0.3).sort((a, b) => a.km - b.km);
    return list.length ? { name: list[0].name, m: Math.round(list[0].km * 1000) } : { name: null };
  }

  async function compsOSM(lat, lon, rKm) {
    const q = `[out:json][timeout:25];nwr["shop"="laundry"](around:${Math.round(rKm * 1420)},${lat},${lon});out center tags;`;
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q) });
    const j = await r.json();
    const comps = j.elements.map((e) => {
      const la = e.lat ?? e.center.lat, lo = e.lon ?? e.center.lon, t = e.tags || {};
      return {
        name: t.name || "（名前なし）",
        address: [t["addr:province"], t["addr:city"], t["addr:quarter"], t["addr:neighbourhood"], t["addr:block_number"], t["addr:housenumber"]].filter(Boolean).join("") || "",
        lat: la, lon: lo, km: distKm(lat, lon, la, lo), hours: t.opening_hours,
        photo: /^https:\/\//.test(t.image || "") ? { src: () => t.image, by: "" } : null,
      };
    });
    return { comps, note: "OpenStreetMap に登録されたお店です。登録されていない店が多いため、実際より少なく出ます。" };
  }

  // ---------------------------------------------------------------- 地図
  const map = {
    async init() {
      if (USE_GOOGLE) {
        await google.maps.importLibrary("maps");
        this.g = new google.maps.Map($("#map"), {
          center: { lat: 35.68, lng: 139.76 }, zoom: 13, mapTypeControl: false, streetViewControl: false,
          fullscreenControl: true, clickableIcons: false, gestureHandling: "greedy",
        });
        this.objs = [];
      } else {
        this.l = L.map("map", { zoomControl: true });
        L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
          maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
        }).addTo(this.l);
        this.layer = L.layerGroup().addTo(this.l);
      }
    },
    draw(fit) {
      const [r1, r2] = radii(), { lat, lon } = cur;
      const accent = "#e2621b", rival = "#2f5f9f", grey = "#8a7d72";
      if (USE_GOOGLE) {
        this.objs.forEach((o) => o.setMap(null)); this.objs = [];
        const G = google.maps, add = (o) => this.objs.push(o);
        add(new G.Circle({ map: this.g, center: { lat, lng: lon }, radius: r1 * 1000, strokeColor: accent, strokeWeight: 3, fillColor: accent, fillOpacity: 0.08, clickable: false }));
        add(new G.Circle({ map: this.g, center: { lat, lng: lon }, radius: r2 * 1000, strokeColor: accent, strokeWeight: 2, strokeOpacity: 0.6, fillOpacity: 0, clickable: false }));
        add(new G.Marker({ map: this.g, position: { lat, lng: lon }, zIndex: 999, title: "候補地",
          icon: { path: "M0,-11 L11,0 L0,11 L-11,0 Z", fillColor: "#e2621b", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2, scale: 1.2 } }));
        cur.comps.forEach((c, i) => {
          const m = new G.Marker({ map: this.g, position: { lat: c.lat, lng: c.lon }, zIndex: 500 - i, title: c.name,
            label: { text: String(i + 1), color: "#fff", fontSize: "11px", fontWeight: "700" },
            icon: { path: G.SymbolPath.CIRCLE, scale: i === active ? 14 : 11, fillColor: c.km <= r2 ? rival : grey, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 } });
          m.addListener("click", () => select(i, true));
          add(m);
        });
        if (fit) {
          const dlat = r2 / 110.57 * 1.05, dlon = r2 / (111.32 * Math.cos(lat * Math.PI / 180)) * 1.05;
          this.g.fitBounds({ south: lat - dlat, north: lat + dlat, west: lon - dlon, east: lon + dlon }, 8);
        }
      } else {
        this.layer.clearLayers();
        L.circle([lat, lon], { radius: r1 * 1000, color: accent, weight: 3, fillOpacity: 0.08 }).addTo(this.layer);
        L.circle([lat, lon], { radius: r2 * 1000, color: accent, weight: 2, opacity: 0.6, fill: false }).addTo(this.layer);
        L.marker([lat, lon], { icon: L.divIcon({ className: "", html: '<i class="pin-own"></i>', iconSize: [18, 18] }), zIndexOffset: 1000 }).addTo(this.layer);
        cur.comps.forEach((c, i) => {
          const cls = "pin" + (c.km <= r2 ? "" : " out") + (i === active ? " on" : "");
          L.marker([c.lat, c.lon], { icon: L.divIcon({ className: cls, html: String(i + 1), iconSize: [24, 24] }), zIndexOffset: 500 - i })
            .on("click", () => select(i, true)).addTo(this.layer);
        });
        if (fit) this.l.invalidateSize();
        if (fit) this.l.fitBounds(L.latLng(lat, lon).toBounds(r2 * 2100));
      }
    },
    focus(c) {
      if (USE_GOOGLE) this.g.panTo({ lat: c.lat, lng: c.lon }); else this.l.panTo([c.lat, c.lon]);
    },
  };

  // ---------------------------------------------------------------- 表示
  function renderStats() {
    const [r1, r2] = radii();
    // 第2商圏は第1商圏の外側（ドーナツ型）だけを数える
    const lo = Math.min(r1, r2);
    $("#stats").innerHTML = [["第1商圏", 0, r1, `半径 ${r1}km`, ""], ["第2商圏", lo, r2, `${lo}〜${r2}km`, "dash"]].map(([label, rIn, r, range, cls]) => {
      const s = sumWithin(r, rIn), inR = cur.comps.filter((c) => c.km > rIn && c.km <= r), n = inR.length, u = inR.filter((c) => c.unsure).length;
      const size = s.hh ? (s.pop / s.hh).toFixed(2) : "-";
      const per = rIn ? ["他社1店あたり", n ? `${fmt(s.hh / n)}<small>世帯</small>` : "他社なし"] : ["自店を含む1店あたり", `${fmt(s.hh / (n + 1))}<small>世帯</small>`];
      return `<article class="card stat">
        <div class="stat-top"><span class="ring-tag"><span class="swatch ${cls}"></span>${label}</span><span class="radius-pill">${range}</span></div>
        <div class="hero-num"><span class="label">世帯数</span><span class="value">${fmt(s.hh)}</span><span class="unit">世帯</span></div>
        <div class="rival-bar"><span>他社のコインランドリー</span><b>${n}<small>店${u ? `（うち要確認${u}）` : ""}</small></b></div>
        <dl class="tiles">
          <div><dt>人口</dt><dd>${fmt(s.pop)}<small>人</small></dd></div>
          <div><dt>${per[0]}</dt><dd>${per[1]}</dd></div>
          <div><dt>単身世帯</dt><dd>${fmt(s.single)}<small>世帯</small></dd></div>
          <div><dt>6歳未満の子がいる</dt><dd>${fmt(s.kids)}<small>世帯</small></dd></div>
          <div><dt>65歳以上がいる</dt><dd>${fmt(s.senior)}<small>世帯</small></dd></div>
          <div><dt>平均世帯人員</dt><dd>${size}<small>人</small></dd></div>
        </dl></article>`;
    }).join("");
  }
  function renderVerdict() {
    const e = estimate(), [g, gl, cls] = GRADES[e.grade];
    cur.est = e;
    const box = $("#verdict");
    // 売上予測は「売上予測を見る」を押してから出す
    box.hidden = !cur.shown; $("#planCard").hidden = !cur.shown;
    if (!cur.shown) { $("#pverdict").innerHTML = ""; return; }
    box.className = "card verdict " + cls;
    box.innerHTML = `<div class="v-top"><div class="v-grade"><b>${g}</b><span>${gl}</span></div>
      <button type="button" class="btn ghost" id="saveBtn">${isSaved() ? "保存済み ✓" : "この候補地を保存"}</button></div>
      <div class="v-nums">
        <div><span class="label">月の売上の見込み</span><span class="value">${!e.lo ? "〜" + e.hi / 1e4 : e.lo / 1e4 + (e.hi ? "〜" + e.hi / 1e4 : "")}</span><span class="unit">万円${!e.lo ? "未満" : e.hi ? "" : "以上"}</span><small>${e.roadNG ? "幹線道路の必須条件がそろっていません" : `基準（お店の条件 ±0点） ${bandTxt(e.band0)}`}</small></div>
        <div><span class="label">来店客数の見込み</span><span class="value">${!e.lo ? "〜" + fmt(e.dayHi) : fmt(e.dayLo) + (e.dayHi ? "〜" + fmt(e.dayHi) : "")}</span><span class="unit">人／日${e.dayHi ? "" : "以上"}</span><small>客単価${fmt(P.price)}円で計算</small></div>
      </div>
      <p class="v-ramp">開業1年目はこの約${Math.round(REF.ramp[0] * 100)}%、2年目は約${Math.round(REF.ramp[1] * 100)}%が目安です（直営店の伸び方より）</p>
      <ul class="v-cond"></ul>
      <p class="v-spec">お店の条件 基準から<b>${signed(e.pt)}</b>点　${e.roadNG ? "→ 幹線道路沿いの必須条件がそろっていないため100万円未満にしました" : e.band > e.band0 ? "→ 売上の見込みを" + (e.band - e.band0) + "段階上げました" : e.band < e.band0 ? "→ 売上の見込みを" + (e.band0 - e.band) + "段階下げました" : "→ 売上の見込みはそのまま"}<small>上の「お店の条件」で変えられます</small></p>
      <p class="v-note">${e.base === 2 ? "世帯数が直営店より少ない、または直営店にない条件が重なっている場所です。現地の様子とあわせて慎重に判断してください。" : e.base === 1 ? "直営店にない条件が1つあるため、見込みより上下にずれやすい場所です。" : ""}この見込みは、ランドリープレス直営店の売上実績をもとに算出しています（軌道に乗った3年目の目安）。</p>`;
    const ul = box.querySelector(".v-cond");
    for (const c of e.cond) {
      const li = document.createElement("li"); li.className = c.extra ? (c.up ? "up" : "ok") : c.pos ? "ng" : "ok";
      li.innerHTML = `<span class="mk">${c.extra ? (c.up ? "↑" : "–") : c.pos ? "!" : "✓"}</span><span class="lb"></span><b></b><small></small>`;
      li.querySelector(".lb").textContent = c.label;
      li.querySelector("b").textContent = c.value;
      li.querySelector("small").textContent = c.extra ? (c.up ? "マンションが多い地域なので、基準を1段階上げました" : "5割未満（一軒家が多め）なので、基準はそのまま")
        : c.pos < 0 ? c.low : c.pos > 0 ? c.high : "直営店の範囲内";
      ul.appendChild(li);
    }
    $("#saveBtn").addEventListener("click", saveCurrent);
    $("#pverdict").innerHTML = `<b class="${cls}">${g}</b><div><span>${gl}</span><p>売上 月<strong>${bandTxt(e.band)}</strong>（直営店の売上実績をもとに算出・お店の条件 基準から${signed(e.pt)}点）</p></div>`;
  }

  // ---------------------------------------------------------------- 候補地の保存と比較
  const savedKey = () => { const [r1, r2] = radii(); return `${cur.address}|${r1}|${r2}`; };
  const isSaved = () => (store.get("saved") || []).some((x) => x.key === savedKey());
  function saveCurrent() {
    const [r1, r2] = radii(), e = cur.est;
    const list = (store.get("saved") || []).filter((x) => x.key !== savedKey());
    list.unshift({
      key: savedKey(), address: cur.address, r1, r2, grade: e.grade, band: e.band, pt: e.pt, v: 3, day: e.dayLo, sales: e.sales,
      hh1: sumWithin(1).hh, hh2: sumWithin(2).hh, c1: cur.comps.filter((c) => c.km <= 1 && !c.closed).length,
      at: Date.now(),
    });
    store.set("saved", list.slice(0, 20));
    $("#saveBtn").textContent = "保存済み ✓";
    renderCompare();
  }
  function renderCompare() {
    const list = store.get("saved") || [], ol = $("#cmpList");
    $("#compare").hidden = !list.length;
    ol.textContent = "";
    list.forEach((x, i) => {
      const [g, gl, cls] = GRADES[x.band != null ? gradeOf(x.band) : x.grade];
      const li = document.createElement("li");
      li.className = "cmp";
      li.innerHTML = `<div class="cmp-head"><b class="cmp-grade ${cls}">${g}</b><button type="button" class="cmp-name"></button>
        <button type="button" class="cmp-del" aria-label="削除">×</button></div>
        <dl class="cmp-nums">
          <div><dt>売上／月</dt><dd><small>${x.band != null ? bandTxt(x.band) : SALES_TXT[x.grade]}</small></dd></div>
          <div><dt>1km以内の世帯</dt><dd>${fmt(x.hh1)}</dd></div>
          <div><dt>2km以内の世帯</dt><dd>${fmt(x.hh2 || 0)}</dd></div>
          <div><dt>1km以内の他社</dt><dd>${x.c1 ?? x.n1}<small>店</small></dd></div>
          ${x.pt != null && x.v === 3 ? `<div><dt>お店の条件</dt><dd>${signed(x.pt)}<small>点</small></dd></div>` : ""}
        </dl><p class="cmp-sub">${gl}</p>`;
      li.querySelector(".cmp-name").textContent = x.address;
      li.querySelector(".cmp-name").onclick = () => {
        $("#addr").value = x.address; $("#r1").value = x.r1; $("#r2").value = x.r2;
        window.scrollTo({ top: 0, behavior: "smooth" }); run(x.address);
      };
      li.querySelector(".cmp-del").onclick = () => {
        store.set("saved", (store.get("saved") || []).filter((y) => y.key !== x.key));
        renderCompare(); if (cur && $("#saveBtn")) $("#saveBtn").textContent = isSaved() ? "保存済み ✓" : "この候補地を保存";
      };
      ol.appendChild(li);
    });
  }

  function renderSpec() {
    const box = $("#spec"); if (!box) return;
    const body = box.querySelector(".spec-body"); body.textContent = "";
    const upd = () => { store.set("spec4", S); renderSpecPts(); if (cur) { renderVerdict(); renderPrint(); } };
    for (const d of SPEC_DEF) {
      const row = document.createElement("div"); row.className = "spec-row";
      row.innerHTML = `<span class="spec-lb"></span><div class="seg"></div><b class="spec-pt"></b>`;
      row.querySelector(".spec-lb").textContent = d.label;
      d.opts.forEach(([t, v], i) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = v === 0 ? `${t}（基準）` : t;
        b.className = S[d.k] === i ? "on" : "";
        b.onclick = () => { S[d.k] = i; renderSpec(); upd(); };
        row.querySelector(".seg").appendChild(b);
      });
      row.dataset.k = d.k;
      if (d.k === "park" && cur) {
        const n = document.createElement("small"); n.className = "spec-auto";
        n.textContent = isCity() ? `500m以内に${fmt(sumWithin(0.5).hh)}世帯ある街中なので、駐車場が少なくても減点しません` : `500m以内は${fmt(sumWithin(0.5).hh)}世帯です（7,000世帯以上なら駐車場なしでも減点しません）`;
        row.appendChild(n);
      }
      if (d.k === "near" && cur && cur.nearAuto) {
        const n = document.createElement("small"); n.className = "spec-auto";
        n.textContent = cur.nearAuto.name ? `Googleマップで自動判定：${cur.nearAuto.name}（約${cur.nearAuto.m}m）` : "Googleマップで自動判定：300m以内に見つかりませんでした";
        row.appendChild(n);
      }
      body.appendChild(row);
      if (d.k === "road" && S.road === 1) {
        const sub = document.createElement("div"); sub.className = "spec-sub";
        sub.innerHTML = `<p>幹線道路沿いは次の3つが必須です。1つでも欠けると売上の見込みは80〜100万円までになります</p>`;
        sub.classList.toggle("ng", !roadOK());
        for (const [k, t] of ROAD_OK) {
          const l = document.createElement("label");
          l.innerHTML = `<input type="checkbox"><span></span>`;
          l.querySelector("span").textContent = t;
          const c = l.querySelector("input"); c.checked = !!S[k];
          c.onchange = () => { S[k] = c.checked; sub.classList.toggle("ng", !roadOK()); upd(); };
          sub.appendChild(l);
        }
        body.appendChild(sub);
      }
    }
    renderSpecPts();
    renderChecks();
  }
  function renderChecks() {
    const box = $("#chkBody"); if (!box) return;
    box.textContent = "";
    for (const d of CHECK_DEF) {
      const row = document.createElement("div"); row.className = "spec-row chk";
      row.innerHTML = `<span class="spec-lb"></span><div class="seg"></div>`;
      row.querySelector(".spec-lb").textContent = d.label;
      CHECK_OPTS.forEach((t, i) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = t;
        b.className = (CK[d.k] || 0) === i ? "on" : "";
        b.onclick = () => { CK[d.k] = i; store.set("check1", CK); renderChecks(); if (cur && cur.shown) renderVerdict(); };
        row.querySelector(".seg").appendChild(b);
      });
      box.appendChild(row);
    }
    // 地域の特徴（自動）: 高齢者・子育て世帯の割合
    const auto = document.createElement("div"); auto.className = "spec-row chk";
    if (cur) {
      const s1 = sumWithin(1), hh = Math.max(1, s1.hh);
      auto.innerHTML = `<span class="spec-lb">1km以内の世帯のうち（自動）</span><small class="spec-auto"></small>`;
      auto.querySelector("small").textContent = `65歳以上がいる世帯 ${Math.round(s1.senior / hh * 100)}%・6歳未満の子がいる世帯 ${Math.round(s1.kids / hh * 100)}%（布団・毛布の需要の目安）`;
    } else {
      auto.innerHTML = `<span class="spec-lb">高齢者・子育て世帯の割合</span><small class="spec-auto">住所を調べると自動で出ます</small>`;
    }
    box.appendChild(auto);
  }
  const checkList = () => CHECK_DEF.map((d) => ({ label: d.label, choice: CHECK_OPTS[CK[d.k] || 0] }));
  function renderSpecPts() {
    const box = $("#spec"); if (!box) return;
    for (const row of box.querySelectorAll(".spec-row:not(.chk)")) {
      const d = SPEC_DEF.find((x) => x.k === row.dataset.k);
      row.querySelector(".spec-pt").textContent = `${signed(specPt(d))}点`;
    }
    const pt = specScore();
    box.querySelector(".spec-total").innerHTML = `基準から <b>${signed(pt)}</b>点`;
  }
  // ① 商圏調査 ／ ② 売上予測 の切り替え
  function showTab(n) {
    for (const i of [1, 2]) {
      $("#panel" + i).hidden = i !== n;
      const b = $("#tabBtn" + i); b.classList.toggle("on", i === n); b.setAttribute("aria-selected", i === n);
    }
    if (n === 1) window.dispatchEvent(new Event("resize"));
    $(".tabs").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  $("#tabBtn1").addEventListener("click", () => showTab(1));
  $("#tabBtn2").addEventListener("click", () => showTab(2));
  $("#goTab2").addEventListener("click", () => showTab(2));
  $("#predictBtn").addEventListener("click", () => {
    if (!cur) return;
    cur.shown = true; renderVerdict(); renderPrint(); renderPlanForm();
    $("#verdict").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  // ボタンをタップした瞬間に光らせる
  document.addEventListener("pointerdown", (ev) => {
    const b = ev.target.closest("button, .btn, summary"); if (!b || b.disabled) return;
    b.classList.remove("tap"); void b.offsetWidth; b.classList.add("tap");
    b.addEventListener("animationend", () => b.classList.remove("tap"), { once: true });
  });
  // ---------------------------------------------------------------- 事業計画書（Excel）
  // 「商圏分析と事業計画書の自動作成」と同じ形式・同じ費用の前提で、売上はこの売上予測を使う
  const PLAN0 = { open: "", rent: 150000, invest: 25000000, own: 5000000 };
  const PLAN_FIELDS = [["name", "店舗名", "text"], ["open", "開業予定日", "text", "例: 2027年4月"], ["rent", "地代・家賃（月）", "yen"], ["invest", "初期投資額", "yen"], ["own", "自己資金", "yen"]];
  let planIn = { ...PLAN0, ...(store.get("plan") || {}) };
  const loadScript = (src) => new Promise((ok, ng) => { const t = document.createElement("script"); t.src = src; t.onload = ok; t.onerror = ng; document.head.appendChild(t); });
  function renderPlanForm() {
    const box = $("#planFields"); if (!box) return;
    box.textContent = "";
    for (const [k, label, type, ph] of PLAN_FIELDS) {
      const l = document.createElement("label"); l.className = "plan-f";
      l.innerHTML = `<span></span><div class="field"><input${type === "yen" ? ' inputmode="numeric"' : ""}>${type === "yen" ? "<small>円</small>" : ""}</div>`;
      l.querySelector("span").textContent = label;
      const inp = l.querySelector("input"); inp.dataset.k = k;
      if (ph) inp.placeholder = ph;
      const v = k === "name" ? (planIn.name || "") : planIn[k];
      inp.value = type === "yen" ? fmt(v) : v;
      if (k === "name") inp.placeholder = defaultName();
      inp.addEventListener("change", () => {
        planIn[k] = type === "yen" ? Math.max(0, +inp.value.replace(/[^\d]/g, "") || 0) : inp.value.trim();
        if (type === "yen") inp.value = fmt(planIn[k]);
        store.set("plan", planIn);
      });
      box.appendChild(l);
    }
  }
  const defaultName = () => "コインランドリー（" + (cur && cur.matched ? cur.matched.replace(/^.*?[都道府県]/, "").replace(/[0-9０-９一二三四五六七八九十〇]+丁目.*$|[0-9０-９].*$/, "") : "候補地") + "）";
  function planData() {
    const e = estimate(), [r1, r2] = radii(), [g, gl] = GRADES[e.grade];
    const k1 = sumWithin(1), k2 = sumWithin(2), ring1 = sumWithin(r1), ring2 = sumWithin(r2, r1), h05 = sumWithin(0.5).hh;
    const live = cur.comps.filter((c) => !c.closed);
    const n = (km) => live.filter((c) => c.km <= km).length;
    const single = k1.single / Math.max(1, k1.hh);
    const sales = e.lo || e.hi;
    const spec = SPEC_DEF.filter((d) => !(S.road === 0 && ["lanes", "access", "speed"].includes(d.k)))
      .map((d) => ({ label: d.label, choice: d.opts[S[d.k]][0], pt: specPt(d) }));
    if (S.road === 1) for (const [k, t] of ROAD_OK) spec.push({ label: "幹線道路の必須条件: " + t, choice: S[k] ? "はい" : "いいえ", pt: 0 });
    const cond = e.cond.map((c) => ({ label: c.label, value: c.value,
      note: c.extra ? (c.up ? "マンションが多い地域なので、基準を1段階上げた" : "5割未満（一軒家が多め）なので、基準はそのまま") : c.pos < 0 ? c.low : c.pos > 0 ? c.high : "直営店の範囲内" }));
    // 文章（黄色の欄なので、あとから書き換えられる）
    const target = (single >= APT_RATIO ? "単身世帯の割合が高い（1km以内の" + Math.round(single * 100) + "%）ため、洗濯機を持たない・乾燥機のない一人暮らしの方、" : "ファミリー世帯が中心のため、") +
      (k1.kids > 0 ? "布団・毛布など大物を洗いたい子育て世帯、" : "") + "共働きで「まとめ洗い・まとめ乾燥」をしたい方、雨の日や花粉の季節の乾燥ニーズ。";
    const areaText = `1km以内に約${fmt(k1.hh)}世帯、2km以内に約${fmt(k2.hh)}世帯。` +
      (e.base === 0 ? "世帯数・他社の数とも、ランドリープレス直営店と同じくらいの条件の商圏。" : e.base === 1 ? "直営店にない条件が1つあり、売上は上下にずれやすい商圏。" : "世帯数が直営店より少ない、または直営店にない条件が重なる商圏のため、慎重な判断が必要。") +
      (single >= APT_RATIO ? "マンションが多い地域で、コインランドリーの利用が見込みやすい。" : "") + (h05 >= CITY_HH ? "500m以内に" + fmt(h05) + "世帯あり、歩き・自転車のお客さんも見込める。" : "");
    const near = live.slice(0, 3).map((c) => `${c.name}（${c.km.toFixed(1)}km）`).join("、");
    const compText = `500m以内に${n(0.5)}店、1km以内に${n(1)}店、2km以内に${n(2)}店のコインランドリーがある。` + (near ? "近い店: " + near + "。" : "") +
      (S.rival === 1 ? "500m以内に大型店や新しい店舗があり、差別化が必要。" : "500m以内に大型店や新しい店舗はない。");
    const st = [];
    if (S.road === 0) st.push("生活道路沿いで、近所の方が立ち寄りやすい");
    if (S.near === 1) st.push("300m以内にスーパー・ドラッグストアがあり、買い物ついでに使える");
    if (S.see === 2) st.push("角地・看板でお店がよく見える");
    if (S.parkEase === 2) st.push("駐車場が道から直接入れて止めやすい");
    if (S.big === 1) st.push("布団が洗える大型洗濯機がある");
    if (S.clean === 1) st.push("クリーニング併設");
    if (S.rival === 0) st.push("500m以内に大型店や新しい競合店がない");
    if (single >= APT_RATIO) st.push("マンションが多く、コインランドリーを使う世帯が多い地域");
    st.push("ランドリープレスの運営ノウハウ（清潔な店内・明るい照明・キャッシュレス対応）");
    const rk = [];
    if (S.rival === 1) rk.push("近くの競合店 → 清潔さ・機械の新しさ・大型機の訴求で差別化する");
    if (S.road === 1) rk.push("幹線道路沿いで入りにくい → 看板・誘導で入口をわかりやすくする");
    if (specPt(SPEC_DEF.find((d) => d.k === "park")) < 0) rk.push("駐車場が少ない → 近隣のお客さん（歩き・自転車）を中心に集客する");
    if (S.night === 0) rk.push("夜が暗い → 店内外の照明・防犯カメラで入りやすくする");
    if (e.base > 0) rk.push("直営店と条件が違う商圏 → 開業後の売上を毎月確認し、早めに手を打つ");
    rk.push("天候・季節で売上が上下する → 梅雨・花粉・冬の布団洗いの時期に集中して宣伝する");
    rk.push("機械の故障 → 保守契約を結び、止まる時間を短くする");
    return {
      address: cur.address, matched: cur.matched, lat: cur.lat, lon: cur.lon,
      created: new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" }),
      mode: "forecast",
      areaRows: [{ label: `第1商圏（半径${r1}km）`, ...ring1, sum: true }, { label: `第2商圏（${r1}〜${r2}km）`, ...ring2, sum: true },
        { label: "参考: 1km以内", ...k1 }, { label: "参考: 2km以内", ...k2 }],
      comps: cur.comps.map((c) => ({ name: c.name + (c.closed ? "（臨時休業中）" : ""), km: c.km, address: c.address || "",
        ring: c.km <= r1 ? "第1商圏" : c.km <= r2 ? "第2商圏" : "商圏外" })),
      compSrc: USE_GOOGLE ? "Google マップ" : "OpenStreetMap",
      est: { mark: g, markText: gl, bandText: "月" + bandTxt(e.band), baseText: e.roadNG ? "幹線道路の必須条件がそろっていないため80〜100万円まで" : bandTxt(e.band0), ptText: `基準から${signed(e.pt)}点`, cond },
      spec, checks: checkList(), target, areaText, compText, strengths: st.join("。") + "。", risks: rk.join("。") + "。",
      inputs: { name: planIn.name || defaultName(), open: planIn.open, price: P.price, sales,
        salesNote: e.lo ? `売上予測（${bandTxt(e.band)}）の下限＝固めの数字` : "売上予測の上限",
        varRate: 0.3, clean: 50000, rent: planIn.rent, other: 50000, invest: planIn.invest, own: Math.min(planIn.own, planIn.invest), rate: 0.02, years: 10, dep: 10 },
    };
  }
  $("#planBtn").addEventListener("click", async () => {
    if (!cur) return;
    const btn = $("#planBtn"), msg = $("#planMsg");
    document.querySelectorAll("#planFields input").forEach((i) => i.dispatchEvent(new Event("change")));
    btn.disabled = true; msg.textContent = "つくっています…";
    try {
      if (!window.JSZip) await loadScript("vendor/jszip/jszip.min.js");
      if (!window.OpenNaviPlan) await loadScript("plan.js?v=3");
      const d = planData();
      const blob = await window.OpenNaviPlan.makePlan(d);
      const fname = `事業計画書_${d.inputs.name.replace(/[\\/:*?"<>|]/g, "")}.xlsx`;
      const file = new File([blob], fname, { type: blob.type });
      // スマホは「共有」からファイルに保存・LINEやメールで送れるように
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        try { await navigator.share({ files: [file], title: fname }); msg.textContent = "できました。"; return; } catch (err) { if (err.name === "AbortError") { msg.textContent = ""; return; } }
      }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fname;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      msg.textContent = `「${fname}」をダウンロードしました。`;
    } catch (err) {
      console.error(err); msg.textContent = "うまく作れませんでした。もう一度お試しください。";
    } finally { btn.disabled = false; }
  });
  renderPlanForm();

  $("#specReset")?.addEventListener("click", () => { S = { ...SPEC0 }; store.set("spec4", S); CK = {}; store.set("check1", CK); renderSpec(); if (cur) { renderVerdict(); renderPrint(); } });
  renderSpec();

  // ---------------------------------------------------------------- 計算の前提
  function renderSettings() {
    const grid = $("#setGrid"); grid.textContent = "";
    for (const [k, label, unit, , step] of PARAM_DEF) {
      const l = document.createElement("label"); l.className = "set-item";
      l.innerHTML = `<span></span><span class="num-in"><input type="number" min="0" step="${step}" inputmode="decimal"><i></i></span>`;
      l.querySelector("span").textContent = label;
      l.querySelector("i").textContent = unit;
      const inp = l.querySelector("input"); inp.value = P[k];
      if (P[k] !== PARAM0[k]) l.classList.add("changed");
      inp.addEventListener("input", () => {
        const v = parseFloat(inp.value);
        if (!(v >= 0)) return;
        P[k] = v; store.set("params", P);
        l.classList.toggle("changed", v !== PARAM0[k]);
        if (cur) { renderVerdict(); renderPrint(); }
      });
      grid.appendChild(l);
    }
  }
  $("#setReset").addEventListener("click", () => { P = { ...PARAM0 }; store.set("params", P); renderSettings(); if (cur) { renderVerdict(); renderPrint(); } });

  let moreOpen = false;
  function renderList() {
    const [r1, r2] = radii(), ol = $("#list");
    ol.textContent = "";
    if (!cur.comps.length) { const li = document.createElement("li"); li.className = "muted"; li.textContent = "見つかりませんでした。"; ol.appendChild(li); return; }
    // 商圏外のお店は「その他のコインランドリー」にまとめて、タップで開く
    const nOut = cur.comps.filter((c) => c.km > r2).length;
    let outOl = null;
    if (nOut) {
      const more = document.createElement("li"); more.className = "more";
      more.innerHTML = `<details${moreOpen ? " open" : ""}><summary>その他のコインランドリー（第2商圏の外・${nOut}店）</summary><ol class="list"></ol></details>`;
      const det = more.querySelector("details");
      det.addEventListener("toggle", () => { moreOpen = det.open; });
      outOl = more.querySelector("ol");
      ol.appendChild(more);
    }
    cur.comps.forEach((c, i) => {
      const ring = c.km <= r1 ? ["第1商圏", ""] : c.km <= r2 ? ["第2商圏", "r2"] : ["商圏外", "out"];
      const li = document.createElement("li");
      li.className = "item" + (ring[1] === "out" ? " out" : "") + (i === active ? " active" : "");
      li.dataset.i = i;
      li.innerHTML = `<span class="num">${i + 1}</span><div class="body">
        <div class="top"><span class="name"></span><span class="km">${c.km.toFixed(1)}km</span></div>
        <div class="small muted addr"></div>
        <div class="chips"><span class="chip ${ring[1]}">${ring[0]}</span></div>
        <div class="links"><a target="_blank" rel="noopener">Googleマップで見る</a></div></div>`;
      li.querySelector(".name").textContent = c.name;
      li.querySelector(".addr").textContent = c.address;
      const chips = li.querySelector(".chips");
      if (c.hours) { const s = document.createElement("span"); s.className = "small"; s.textContent = "営業 " + c.hours; chips.appendChild(s); }
      if (c.unsure) { const s = document.createElement("span"); s.className = "chip out"; s.textContent = "要確認（店名にランドリーなし）"; chips.appendChild(s); }
      if (c.closed) { const s = document.createElement("span"); s.className = "chip warn"; s.textContent = "臨時休業中"; chips.appendChild(s); }
      li.querySelector("a").href = c.url || `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}`;
      if (ring[1] === "out" && outOl) outOl.appendChild(li);
      else ol.insertBefore(li, ol.querySelector(".more"));
    });
  }
  function select(i, scroll) {
    active = i; map.draw(false); map.focus(cur.comps[i]);
    document.querySelectorAll(".item").forEach((li) => li.classList.toggle("active", +li.dataset.i === i));
    if (scroll) { const el = document.querySelector(`.item[data-i="${i}"]`); const det = el && el.closest("details"); if (det && !det.open) det.open = true; el && el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
  function refresh(fit) {
    if (!cur) return;
    store.set("radius", radii());
    renderVerdict(); renderStats(); renderList(); renderPrint(); map.draw(fit);
  }

  // ---------------------------------------------------------------- A4印刷用
  const NEAR = 3, TABLE_MAX = 8;
  function renderPrint() {
    const [r1, r2] = radii(), d = new Date();
    $("#pmeta").textContent = `候補地: ${cur.address}　｜　第1商圏 ${r1}km・第2商圏 ${r2}km　｜　作成日 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    $("#psrc").textContent = `売上の見込み: ランドリープレス直営店の売上実績をもとに算出（客単価${fmt(P.price)}円）　｜　人口・世帯数: 令和2年国勢調査500mメッシュ　｜　` + $("#srcnote").textContent;
    const ring = (c) => (c.km <= r1 ? "第1商圏" : c.km <= r2 ? "第2商圏" : "商圏外");
    const label = (c) => c.name + (c.unsure ? "（要確認）" : "") + (c.closed ? "（臨時休業中）" : "");
    // 近い順に3店を写真つきで
    const near = $("#pnear"); near.textContent = "";
    const h = document.createElement("h3"); h.textContent = "候補地から近い他社コインランドリー"; near.appendChild(h);
    const row = document.createElement("div"); row.className = "pnear-row"; near.appendChild(row);
    cur.comps.slice(0, NEAR).forEach((c, i) => {
      const card = document.createElement("article"); card.className = "pcard";
      card.innerHTML = `<div class="pphoto"><span>写真なし</span></div><div class="pbody"><p class="pname"><b>${i + 1}</b><span></span></p><p class="pinfo"></p><p class="paddr"></p><p class="pby"></p></div>`;
      card.querySelector(".pname span").textContent = label(c);
      card.querySelector(".pinfo").textContent = `${c.km.toFixed(2)}km・${ring(c)}`;
      card.querySelector(".paddr").textContent = c.address;
      if (c.photo) {
        const img = document.createElement("img"); img.alt = ""; img.dataset.idx = i;
        card.querySelector(".pphoto").replaceChildren(img);
        card.querySelector(".pby").textContent = c.photo.by ? `写真: ${c.photo.by}（Google）` : "";
      }
      row.appendChild(card);
    });
    if (!cur.comps.length) { const p = document.createElement("p"); p.textContent = "近くに他社のコインランドリーは見つかりませんでした。"; row.appendChild(p); }
    // 第2商圏までの一覧（多いときは先頭から）
    const t = $("#ptable"); t.textContent = "";
    const rows = cur.comps.map((c, i) => [i + 1, c]).filter(([, c]) => c.km <= r2);
    t.innerHTML = `<caption>第2商圏までの他社（${rows.length}店・番号は地図と同じ）</caption>
      <thead><tr><th>No.</th><th>店名</th><th>距離</th><th>商圏</th></tr></thead><tbody></tbody>`;
    const tb = t.querySelector("tbody");
    if (!rows.length) tb.innerHTML = '<tr><td colspan="4">第2商圏の中に他社は見つかりませんでした。</td></tr>';
    for (const [no, c] of rows.slice(0, TABLE_MAX)) {
      const tr = document.createElement("tr");
      [no, label(c), c.km.toFixed(2) + "km", ring(c).replace("商圏", "")]
        .forEach((v) => { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); });
      tb.appendChild(tr);
    }
    if (rows.length > TABLE_MAX) tb.insertAdjacentHTML("beforeend", `<tr><td colspan="4" class="more">ほか ${rows.length - TABLE_MAX}店（アプリの一覧をご覧ください）</td></tr>`);
  }
  // 印刷の直前に写真を読み込み、読み終わるのを待つ（最大5秒）
  function loadPhotos() {
    const imgs = [...document.querySelectorAll("#pnear img")];
    return Promise.race([
      Promise.all(imgs.map((img) => new Promise((ok) => {
        if (!img.src) { try { img.src = cur.comps[+img.dataset.idx].photo.src(); } catch (e) { return ok(); } }
        if (img.complete) return ok();
        img.onload = img.onerror = () => ok();
      }))),
      new Promise((ok) => setTimeout(ok, 5000)),
    ]);
  }
  // 地図を印刷用の大きさにしてから印刷する（地図の読み込みを少し待つ）
  let printing = false;
  function enterPrint() {
    if (printing) return; printing = true;
    document.body.classList.add("printing"); map.draw(true);
  }
  function leavePrint() {
    if (!printing) return; printing = false;
    document.body.classList.remove("printing"); setTimeout(() => map.draw(true), 50);
  }
  $("#printBtn").addEventListener("click", async () => {
    enterPrint();
    await Promise.all([loadPhotos(), new Promise((ok) => setTimeout(ok, 1500))]);
    window.print();
  });
  window.addEventListener("beforeprint", () => { if (cur) enterPrint(); });
  window.addEventListener("afterprint", leavePrint);
  function msg(text, err) { const m = $("#msg"); m.textContent = text; m.classList.toggle("err", !!err); m.hidden = !text; }

  async function run(addr) {
    const btn = $("#go"); btn.disabled = true;
    try {
      msg("住所を調べています…");
      const g = await geocode(addr);
      msg("人口・世帯数と周辺のお店を調べています…");
      const r2 = radii()[1];
      const searchKm = Math.max(r2, 3);
      const [cells, cres] = await Promise.all([
        buildCells(g.lat, g.lon),
        (USE_GOOGLE ? compsGoogle : compsOSM)(g.lat, g.lon, searchKm).catch((e) => ({ comps: [], note: "他社店舗の検索に失敗しました。時間をおいてもう一度お試しください。" })),
      ]);
      cres.comps.sort((a, b) => a.km - b.km);
      cur = { ...g, address: addr, cells, comps: cres.comps, searchKm, shown: false };
      moreOpen = false;
      for (const i of [1, 2]) { $("#panel" + i).hidden = i !== 1; $("#tabBtn" + i).classList.toggle("on", i === 1); $("#tabBtn" + i).setAttribute("aria-selected", i === 1); }
      // 300m以内のスーパー・ドラッグストアを自動で調べて「お店の条件」に入れる（あとから手で変えられる）
      cur.nearAuto = await nearShops(g.lat, g.lon).catch(() => null);
      if (cur.nearAuto) { S.near = cur.nearAuto.name ? 1 : 0; store.set("spec4", S); }
      renderSpec();
      active = -1;
      $("#compnote").textContent = cres.note + `（半径${searchKm}kmまで検索）`;
      $("#matched").textContent = `${g.matched}（緯度 ${g.lat.toFixed(5)} / 経度 ${g.lon.toFixed(5)}）`;
      $("#gmap").href = `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lon}`;
      $("#result").hidden = false;
      await mapReady;
      if (!cells.length) msg("この場所の人口データが見つかりませんでした。", true); else msg("");
      refresh(true);
      const rec = (store.get("recent") || []).filter((a) => a !== addr); rec.unshift(addr); store.set("recent", rec.slice(0, 5));
      renderRecent();
    } catch (e) {
      msg(e.message || "うまく調べられませんでした。通信環境を確認して、もう一度お試しください。", true);
    } finally { btn.disabled = false; }
  }

  function renderRecent() {
    const box = $("#recent"); box.textContent = "";
    (store.get("recent") || []).forEach((a) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = a;
      b.onclick = () => { $("#addr").value = a; run(a); };
      box.appendChild(b);
    });
  }

  // ---------------------------------------------------------------- 起動
  $("#form").addEventListener("submit", (e) => { e.preventDefault(); const a = $("#addr").value.trim(); if (a) run(a); });
  ["r1", "r2"].forEach((id) => $("#" + id).addEventListener("input", () => refresh(false)));
  document.querySelectorAll(".step").forEach((b) => b.addEventListener("click", () => {
    const el = $("#" + b.dataset.t); el.value = Math.min(10, Math.max(0.25, Math.round(((+el.value || 0) + +b.dataset.d) * 4) / 4)); refresh(true);
  }));
  $("#list").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const li = e.target.closest(".item"); if (li) { select(+li.dataset.i, false); $("#map").scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  });
  const saved = store.get("radius");
  $("#r1").value = saved ? saved[0] : CFG.r1 || 1;
  $("#r2").value = saved ? saved[1] : CFG.r2 || 3;
  $("#srcnote").textContent = USE_GOOGLE ? "他社店舗・地図: Google マップ" : "他社店舗: OpenStreetMap";
  renderRecent(); renderSettings(); renderCompare();

  function loadGoogle() {
    return new Promise((resolve, reject) => {
      window.__gmReady = resolve;
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.googleApiKey)}&v=weekly&language=ja&region=JP&loading=async&callback=__gmReady`;
      s.onerror = reject; document.head.appendChild(s);
    });
  }
  const mapReady = (USE_GOOGLE ? loadGoogle() : Promise.resolve()).then(() => map.init())
    .catch(() => msg("地図を読み込めませんでした。APIキーの設定を確認してください。", true));
})();
