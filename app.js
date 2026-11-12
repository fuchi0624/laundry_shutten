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
    hh2: [9500, 161000],            // 2km以内の世帯数（いちばん少ない宗像店は9,972世帯。境目で外れないよう少しゆとり）
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
      // ただし500m以内に競合店があるときは上げない（2026-11-12 Yuta決定。競合ありの店が高めに出ていたため）
      { label: "1km以内の単身世帯の割合", value: `${Math.round(s1.single / Math.max(1, s1.hh) * 100)}%`, pos: 0, extra: true,
        up: s1.single / Math.max(1, s1.hh) >= APT_RATIO && S.rival !== 1,
        upText: "マンションが多い地域なので、基準を1段階上げました",
        keepText: s1.single / Math.max(1, s1.hh) >= APT_RATIO ? "マンションが多い地域ですが、500m以内に競合店があるので基準はそのまま" : "5割未満（一軒家が多め）なので、基準はそのまま" },
      // 夜も人が来る立地は1段階上げる（2026-11-09 Yuta決定。参考チェックの「はい」）
      { label: "夜も人が来る立地", value: CHECK_OPTS[CK.night || 0], pos: 0, extra: true, up: CK.night === 1,
        upText: "夜も人が来る立地なので、基準を1段階上げました", keepText: "「はい」のときだけ1段階上げます（お店の条件の参考チェックで選べます）" },
    ];
  }
  function estimate() {
    const cond = conditions(), out = cond.filter((c) => !c.extra && c.pos !== 0).length, apt = cond.filter((c) => c.extra && c.up).length;
    // 世帯数が直営店のどの店より少ない場所は、売上が伸びにくいおそれ（世帯がいちばん少ない直営店は100万円未満）
    const fewHH = cond.slice(0, 2).some((c) => c.pos < 0);
    const base = fewHH || out >= 2 ? 2 : out === 1 ? 1 : 0;
    const pt = specScore(), roadNG = S.road === 1 && !roadOK();
    // 商圏の判定で出発点の金額帯を決め、お店の条件4点ごとに1つ上下させる（2026-11-08 直営店14店の答え合わせで、お店側の点を半分の重みに）
    const band0 = BASE_BAND[base] + apt;
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
  // 2026-11-11 Yuta希望で項目を簡素化（直営店14店の答え合わせで精度が変わらないことを確認済み）
  const SPEC_DEF = [
    { k: "road", label: "道", base: 0, opts: [["生活道路沿い", 0], ["幹線道路沿い", -2]] },
    { k: "park", label: "駐車場", base: 2, opts: [["なし", -2], ["1〜3台", -1], ["4〜5台", 0], ["6〜8台", 1], ["9〜10台", 2], ["11台以上", 3]] },
    { k: "tsubo", label: "広さ", base: 4, opts: [["10坪以下", -4], ["10〜15坪", -3], ["15〜20坪", -2], ["20〜25坪", -1], ["25〜30坪", 0], ["30〜35坪", 1], ["35坪以上", 2]] },
    { k: "mach", label: "機械の台数（洗濯乾燥機と乾燥機の合計）", base: 2, opts: [["5台以下", -2], ["6〜7台", -1], ["8〜9台", 0], ["10〜11台", 1], ["12台以上", 2]] },
    { k: "see", label: "お店の見えやすさ（角地・看板・夜の明るさ）", base: 1, opts: [["見つけにくい・暗い", -1], ["ふつう", 0], ["よく見える", 1]] },
    { k: "rival", label: "500m以内に競合店（大型店や新しい店舗）", base: 0, opts: [["ない", 0], ["ある", -6]] },
    { k: "near", label: "300m以内のスーパー・ドラッグストア", base: 1, auto: true, opts: [["ない", -1], ["ある", 0]] },
  ];
  // 参考チェック。「夜も人が来る立地」は はい で1段階上げる（2026-11-09 Yuta決定）。分断は点数なし
  const CHECK_DEF = [
    { k: "night", label: "夜も人が来る立地（駅・飲食店・病院・工場の近く、夜勤の人が多い）", place: true, scored: true },
    { k: "split", label: "商圏が川・線路・大きな道路で分断されている", place: true, bad: true },
  ];
  const CHECK_OPTS = ["わからない", "はい", "いいえ"];
  let CK = { ...(store.get("check1") || {}) };
  const ROAD_OK = [["median", "中央分離帯がない"], ["inout", "反対車線から入りやすく、出やすい"], ["seeOpp", "反対車線から見えやすい"]];
  const SPEC0 = { ...Object.fromEntries(SPEC_DEF.map((d) => [d.k, d.base])), inout: false, seeOpp: false, median: false, parkEase: false };
  let S = { ...SPEC0, ...(store.get("spec5") || {}) };
  // 幹線道路沿いは3つの条件が必須（そろわなければ80〜100万円まで）
  const roadOK = () => ROAD_OK.every(([k]) => S[k]);
  // 500m以内に7,000世帯以上ある街中では、歩き・自転車のお客さんが多いため駐車場が少なくても減点しない（直営店の実績より）
  const CITY_HH = 7000;
  const isCity = () => !!cur && sumWithin(0.5).hh >= CITY_HH;
  // 駐車場は「反対車線からも出入りしやすい」なら+1（旧「止めやすさ」の項目をまとめた）
  const specPt = (d) => {
    let v = d.opts[S[d.k]][1];
    if (d.k === "park") { if (v < 0 && isCity()) v = 0; if (S.park > 0 && S.parkEase) v += 1; }
    return v;
  };
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

  // 参考チェックの自動入力（Googleマップ）: 生活の通り道（500m以内のスーパー・ドラッグストア・駅）と、夜の目安（23時以降も開いているお店の数）
  async function checkAuto(lat, lon) {
    if (!USE_GOOGLE) return null;
    const { Place } = await google.maps.importLibrary("places");
    const near = (types, r, fields) => Place.searchNearby({ fields, includedTypes: types, locationRestriction: { center: { lat, lng: lon }, radius: r },
      maxResultCount: 20, rankPreference: "DISTANCE", language: "ja", region: "jp" }).then((x) => x.places || []).catch(() => []);
    const [shops, food] = await Promise.all([
      near(["supermarket", "drugstore", "train_station", "subway_station"], 500, ["displayName", "location"]),
      near(["restaurant", "bar", "pub", "night_club", "fast_food_restaurant", "karaoke"], 500, ["displayName", "regularOpeningHours"]),
    ]);
    const km = (p) => distKm(lat, lon, p.location.lat(), p.location.lng());
    const r = shops.map((p) => ({ name: p.displayName, m: Math.round(km(p) * 1000) })).sort((a, b) => a.m - b.m);
    const late = food.filter((p) => ((p.regularOpeningHours && p.regularOpeningHours.periods) || []).some((x) => {
      if (!x.close) return true;
      if (x.close.day !== x.open.day) return true;
      return x.close.hour * 60 + x.close.minute >= 23 * 60;
    })).length;
    return { route: r[0] || null, late, food: food.length };
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

  // ---------------------------------------------------------------- 用途地域（国土数値情報 A29 平成31年度）
  // 建築基準法の用途制限から、コインランドリー（店舗）が建てられるか・向いているかの目安（最終確認は役所の建築指導課）
  const ZONES = {
    1: ["第一種低層住居専用地域", "ng", "原則建てられません", "店舗は住宅と一緒の小さなもの（50㎡以下）しか認められず、コインランドリー単独の店は建てられません。ただし道路沿いだけ別の用途地域になっていることがあるので、境目の近くなら役所で確認してください。"],
    2: ["第二種低層住居専用地域", "mid", "条件つき（要確認）", "150㎡（約45坪）以下・2階以下の店舗なら建てられる地域です。コインランドリーを認めるかは役所によって判断が分かれるので、事前に確認が必要です。"],
    3: ["第一種中高層住居専用地域", "ok", "建てられます", "500㎡以下・2階以下の店舗なら建てられます。マンションや住宅が多く、お客さんが近くに住んでいます。"],
    4: ["第二種中高層住居専用地域", "ok", "建てられます", "1,500㎡以下の店舗なら建てられます。住宅が多い地域です。"],
    5: ["第一種住居地域", "best", "建てられます・向いています", "3,000㎡以下の店舗が建てられ、住宅が多い地域です。コインランドリーに向いています。"],
    6: ["第二種住居地域", "best", "建てられます・向いています", "店舗が建てやすく、住宅も多い地域です。コインランドリーに向いています。"],
    7: ["準住居地域", "best", "建てられます・向いています", "幹線道路沿いに多い地域です。住宅も近く、車のお客さんも見込めます。"],
    8: ["近隣商業地域", "best", "建てられます・向いています", "住宅地の近くの商店街です。日常の買い物ついでに使ってもらいやすい地域です。"],
    9: ["商業地域", "best", "建てられます・向いています", "建物の制限はほとんどありません。駅前やマンションの多い街中で、直営店（住吉・日ノ出町など）も売上が高めです。家賃が高めなので、事業計画書で採算も確認してください。"],
    10: ["準工業地域", "ok", "建てられます", "住宅と工場が混ざった地域です。まわりに住宅があるかを確認してください。"],
    11: ["工業地域", "mid", "建てられますが不向き", "店舗は建てられますが、住む人が少ないことが多い地域です。"],
    12: ["工業専用地域", "ng", "原則向きません（要確認）", "工場のための地域で、住宅も店舗もほとんど建てられません。"],
    13: ["田園住居地域", "mid", "条件つき（要確認）", "第二種低層住居専用地域と同じくらいの制限があります。役所に確認が必要です。"],
  };
  const ZONE_NONE = ["用途地域の指定なし", "mid", "要確認", "市街化調整区域なら原則建てられません。都市計画区域外や非線引きの区域なら比較的自由に建てられます。役所の都市計画課で確認してください。"];
  const zoneCache = {};
  const loadZoneTile = (k) => (zoneCache[k] ||= fetch(`data/youto/${k}.json`).then((r) => (r.ok ? r.json() : { p: [] })).catch(() => ({ p: [] })).then((j) => {
    // 差分で縮めた座標を元に戻す
    j.polys = j.p.map(([code, kp, yr, rings]) => ({ code, kp, yr, rings: rings.map((f) => {
      const pts = []; let x = f[0], y = f[1]; pts.push([x / 1e5, y / 1e5]);
      for (let i = 2; i < f.length; i += 2) { x += f[i]; y += f[i + 1]; pts.push([x / 1e5, y / 1e5]); }
      return pts;
    }) }));
    return j;
  }));
  function inRings(rings, lon, lat) {
    let inside = false;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  async function zoneSurvey(lat, lon) {
    const rKm = 0.5, dlat = rKm / 110.57, dlon = rKm / (111.32 * Math.cos(lat * Math.PI / 180));
    const keys = new Set();
    for (const a of [lat - dlat, lat, lat + dlat]) for (const b of [lon - dlon, lon, lon + dlon]) keys.add(`${Math.floor(a * 12)}_${Math.floor(b * 8)}`);
    const tiles = await Promise.all([...keys].map(loadZoneTile));
    const polys = tiles.flatMap((t) => t.polys);
    if (!polys.length) return { none: true };
    const at = (la, lo) => polys.find((p) => inRings(p.rings, lo, la)) || null;
    const here = at(lat, lon);
    // 500m以内の内訳（点を並べて数える）
    const N = 21, cnt = {}; let tot = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const u = (i / (N - 1)) * 2 - 1, v = (j / (N - 1)) * 2 - 1;
      if (u * u + v * v > 1) continue;
      const p = at(lat + u * dlat, lon + v * dlon); const k = p ? p.code : 0;
      cnt[k] = (cnt[k] || 0) + 1; tot++;
    }
    return { here, mix: Object.entries(cnt).map(([k, n]) => ({ code: +k, pct: n / tot })).sort((a, b) => b.pct - a.pct) };
  }
  // 候補地の用途地域と「コインランドリーを出店できるか」だけを一目で（2026-11-11 Yuta希望）
  const ZONE_JUDGE = (code) => [1, 12].includes(code) ? "ng" : [2, 13].includes(code) || !code ? "chk" : "ok";
  const ZONE_NOTE = {
    1: "コインランドリー単独の店は、原則建てられません（道路沿いだけ別の地域のこともあります）",
    2: "150㎡（約45坪）以下なら建てられることが多い地域です。役所で確認してください",
    12: "工場のための地域で、店舗は原則建てられません",
    13: "150㎡（約45坪）以下なら建てられることが多い地域です。役所で確認してください",
    0: "用途地域の指定がない場所です。市街化調整区域だと建てられないので、役所で確認してください",
  };
  function zoneText() {
    const z = cur && cur.zone; if (!z) return "";
    const code = z.none || !z.here ? 0 : z.here.code;
    if (!code) return "用途地域の指定なし（市街化調整区域なら出店できないため、役所で確認）";
    const word = { ok: "出店できます", chk: "要確認", ng: "原則出店できません" }[ZONE_JUDGE(code)];
    return `${ZONES[code][0]}（建ぺい率 ${z.here.kp}%・容積率 ${z.here.yr}%）　コインランドリー：${word}`;
  }
  function renderZone() {
    const box = $("#zone"); if (!box) return;
    const z = cur && cur.zone;
    box.hidden = !z;
    if (!z) return;
    const code = z.none || !z.here ? 0 : z.here.code;
    const j = ZONE_JUDGE(code);
    const name = code ? ZONES[code][0] : "用途地域の指定なし";
    const [mk, word] = { ok: ["OK", "出店できます"], chk: ["?", "要確認"], ng: ["NG", "原則出店できません"] }[j];
    box.className = "zone z-" + j;
    box.innerHTML = `<div class="z-main"><span class="z-eye">ZONING<i>用途地域</i></span><b class="z-name"></b>
      <span class="z-sub">${code ? `建ぺい率 ${z.here.kp}%・容積率 ${z.here.yr}%` : ""}</span></div>
      <div class="z-badge"><span class="z-ring">${mk}</span><small>コインランドリー</small><strong>${word}</strong></div>
      <p class="z-note"></p>`;
    box.querySelector(".z-name").textContent = name;
    box.querySelector(".z-note").textContent = ZONE_NOTE[code] || "コインランドリーの出店に問題ない地域です";
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
      <p class="v-note">${e.base === 2 ? "世帯数が直営店より少ない、または直営店にない条件が重なっている場所です。現地の様子とあわせて慎重に判断してください。" : e.base === 1 ? "直営店にない条件が1つあるため、見込みより上下にずれやすい場所です。" : ""}この見込みは、ランドリープレスの売上実績をもとに算出しています（軌道に乗った3年目の目安）。</p>`;
    const ul = box.querySelector(".v-cond");
    for (const c of e.cond) {
      const li = document.createElement("li"); li.className = c.extra ? (c.up ? "up" : "ok") : c.pos ? "ng" : "ok";
      li.innerHTML = `<span class="mk">${c.extra ? (c.up ? "↑" : "–") : c.pos ? "!" : "✓"}</span><span class="lb"></span><b></b><small></small>`;
      li.querySelector(".lb").textContent = c.label;
      li.querySelector("b").textContent = c.value;
      li.querySelector("small").textContent = c.extra ? (c.up ? c.upText : c.keepText)
        : c.pos < 0 ? c.low : c.pos > 0 ? c.high : "直営店の範囲内";
      ul.appendChild(li);
    }
    $("#saveBtn").addEventListener("click", saveCurrent);
    $("#pverdict").innerHTML = `<b class="${cls}">${g}</b><div><span>${gl}</span><p>売上 月<strong>${bandTxt(e.band)}</strong>（ランドリープレスの売上実績をもとに算出・お店の条件 基準から${signed(e.pt)}点）</p></div>`;
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
    const upd = () => { store.set("spec5", S); renderSpecPts(); if (cur) { renderVerdict(); renderPrint(); } };
    for (const d of SPEC_DEF) {
      const row = document.createElement("div"); row.className = "spec-row";
      row.innerHTML = `<span class="spec-lb"></span><div class="seg"></div><b class="spec-pt"></b>`;
      row.querySelector(".spec-lb").textContent = d.label;
      if (d.auto && cur && cur.nearAuto) row.querySelector(".seg").remove();
      else d.opts.forEach(([t, v], i) => {
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
      if (d.k === "park" && S.park > 0) {
        const l = document.createElement("label"); l.className = "spec-ease";
        l.innerHTML = `<input type="checkbox"><span>反対車線からも出入りしやすい（+1点）</span>`;
        const c = l.querySelector("input"); c.checked = !!S.parkEase;
        c.onchange = () => { S.parkEase = c.checked; upd(); };
        row.appendChild(l);
      }
      if (d.k === "near" && cur && cur.nearAuto) {
        const n = document.createElement("small"); n.className = "spec-auto";
        n.textContent = cur.nearAuto.name ? `自動判定：ある（${cur.nearAuto.name}、約${cur.nearAuto.m}m）` : "自動判定：300m以内に見つかりませんでした";
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
      row.querySelector(".spec-lb").textContent = d.label + (d.scored ? "【はい＝売上の見込みを1段階上げる】" : "");
      CHECK_OPTS.forEach((t, i) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = t;
        b.className = (CK[d.k] || 0) === i ? "on" : "";
        b.onclick = () => { CK[d.k] = i; store.set("check1", CK); renderChecks(); if (cur && cur.shown) renderVerdict(); };
        row.querySelector(".seg").appendChild(b);
      });
      const hint = chkHint(d);
      if (hint) { const n = document.createElement("small"); n.className = "spec-auto"; n.textContent = hint; row.appendChild(n); }
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
  function chkHint(d) {
    const a = cur && cur.chkAuto;
    if (d.k === "night" && a) return `Googleマップの目安：500m以内に夜23時以降も開いている飲食店など${a.late}軒（直営店ではこの数だけでは判断できなかったため、現地の様子で選んでください）`;
    if (d.k === "split") return "地図で、川・線路・大きな道路が商圏を横切っていないか確認してください";
    return "";
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
    cur.shown = true; renderVerdict(); renderPrint(); renderPlanForm(); renderScore(); photosFor();
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
  const PLAN_FIELDS = [["name", "店舗名", "text"], ["client", "客先名（表紙に入ります・任意）", "text", "例: 株式会社〇〇"], ["open", "開業予定日", "text", "例: 2027年4月"], ["rent", "家賃（月）", "yen"], ["invest2", "初期投資額（税込）", "yen0", "空欄なら自動計算"]];
  let planIn = { ...PLAN0, ...(store.get("plan") || {}) };
  const loadScript = (src) => new Promise((ok, ng) => { const t = document.createElement("script"); t.src = src; t.onload = ok; t.onerror = ng; document.head.appendChild(t); });
  function renderPlanForm() {
    const box = $("#planFields"); if (!box) return;
    box.textContent = "";
    for (const [k, label, type, ph] of PLAN_FIELDS) {
      const l = document.createElement("label"); l.className = "plan-f";
      l.innerHTML = `<span></span><div class="field"><input${type !== "text" ? ' inputmode="numeric"' : ""}>${type !== "text" ? "<small>円</small>" : ""}</div>`;
      l.querySelector("span").textContent = label;
      const inp = l.querySelector("input"); inp.dataset.k = k;
      if (ph) inp.placeholder = ph;
      const v = k === "name" ? (planIn.name || "") : (planIn[k] ?? "");
      inp.value = type === "yen" || (type === "yen0" && v !== "") ? fmt(v) : v;
      if (k === "name") inp.placeholder = defaultName();
      inp.addEventListener("change", () => {
        const dg = inp.value.replace(/[^\d]/g, "");
        const man = /万/.test(inp.value) ? 10000 : 1;
        planIn[k] = type === "yen" ? Math.max(0, +dg * man || 0) : type === "yen0" ? (+dg > 0 ? +dg * man : "") : inp.value.trim();
        if (type !== "text") inp.value = planIn[k] === "" ? "" : fmt(planIn[k]);
        store.set("plan", planIn);
      });
      box.appendChild(l);
    }
  }
  const defaultName = () => "コインランドリー（" + (cur && cur.matched ? cur.matched.replace(/^.*?[都道府県]/, "").replace(/[0-9０-９一二三四五六七八九十〇]+丁目.*$|[0-9０-９].*$/, "") : "候補地") + "）";
  // ---------------------------------------------------------------- 立地スコア（事業計画書に入れる。売上予測には使わない）
  // 採点表は keikaku.js（出店計画書の採点表）。わかる項目はオープンナビの入力・自動判定から選んでおく
  let SC = store.get("score1") || null;
  const scoreDef = () => (window.OpenNaviKeikaku ? window.OpenNaviKeikaku.SCORE : null);
  function scoreAuto() {
    const D = scoreDef(); if (!D) return null;
    const on = D.map((c) => c.items.map((it) => !!it.def));
    const pick = (ci, t, v = true) => { const ii = D[ci].items.findIndex((it) => it.t === t); if (ii < 0) return; const g = D[ci].items[ii].group;
      if (g && v) D[ci].items.forEach((it, k) => { if (it.group === g) on[ci][k] = false; }); on[ci][ii] = v; };
    const clearCat = (ci) => { on[ci] = on[ci].map(() => false); };
    pick(0, ["15坪未満", "15坪未満", "15〜20坪未満", "20〜25坪未満", "25〜30坪未満", "30〜40坪未満", "30〜40坪未満"][S.tsubo]);
    pick(1, S.road === 0 ? "買い物ルート等の生活道路沿い（中央分離帯なし）" : S.median ? "交通量の多い幹線道路沿い（中央分離帯なし）" : "交通量の多い幹線道路沿い（中央分離帯あり）");
    pick(2, ["駐車場0〜1台", "駐車場2〜4台", "駐車場5〜7台", "駐車場5〜7台", "駐車場8〜10台以上", "駐車場8〜10台以上"][S.park]);
    pick(2, "駐車しやすい駐車場", !!(S.park > 0 && S.parkEase)); pick(2, "他店との兼用駐車場", false);
    if (cur) { const k1 = sumWithin(1); pick(3, k1.single / Math.max(1, k1.hh) >= APT_RATIO ? "マンション・商業施設混在の都市型" : "一戸建てとマンションが混在"); }
    pick(3, "鉄道や川で商圏が分断", CK.split === 1);
    pick(4, "大型商業施設の敷地内", false); pick(4, "夜でも明るい", S.see !== 0);
    clearCat(5);
    if (cur) {
      const [r1] = radii(), n1 = cur.comps.filter((c) => !c.closed && c.km <= r1).length;
      if (S.rival === 1) pick(5, "第1商圏にAクラス競合"); else if (n1 >= 2) pick(5, "第1商圏にCクラス競合2店以上"); else if (n1 === 1) pick(5, "第1商圏にCクラス競合");
    }
    return on;
  }
  const scoreData = () => { const D = scoreDef(); if (!D) return null; const on = SC && SC.length === D.length ? SC : scoreAuto();
    return D.map((c, ci) => ({ name: c.name, items: c.items.map((it, ii) => ({ ...it, on: !!(on[ci] && on[ci][ii]) })) })); };
  async function renderScore() {
    const box = $("#scoreBody"); if (!box) return;
    if (!window.OpenNaviKeikaku) { try { if (!window.OpenNaviPlan) await loadScript("plan.js?v=7"); await loadScript("keikaku.js?v=3"); } catch (e) { return; } }
    const data = scoreData(); if (!data) return;
    if (!SC) SC = data.map((c) => c.items.map((it) => it.on));
    box.textContent = "";
    let total = 0;
    data.forEach((cat, ci) => {
      const sum = cat.items.reduce((a, it) => a + (it.on ? it.p : 0), 0); total += sum;
      const det = document.createElement("details"); det.className = "sc-cat";
      det.innerHTML = `<summary><span></span><b>${sum}点</b></summary>`;
      det.querySelector("span").textContent = cat.name.replace(/【\d】/, "");
      cat.items.forEach((it, ii) => {
        const l = document.createElement("label"); l.className = "sc-item";
        l.innerHTML = `<input type="${it.group ? "radio" : "checkbox"}"><span></span><i>${it.p > 0 ? "+" : ""}${it.p}</i>`;
        l.querySelector("span").textContent = it.t;
        const c = l.querySelector("input"); c.checked = it.on; if (it.group) c.name = `sc${ci}${it.group}`;
        c.addEventListener("click", () => {
          if (it.group) { if (SC[ci][ii]) { c.checked = false; SC[ci][ii] = false; } else { cat.items.forEach((x, k) => { if (x.group === it.group) SC[ci][k] = false; }); SC[ci][ii] = true; } }
          else SC[ci][ii] = c.checked;
          store.set("score1", SC); const open = [...box.querySelectorAll("details")].map((x) => x.open); renderScore().then(() => box.querySelectorAll("details").forEach((x, k) => (x.open = open[k])));
        });
        det.appendChild(l);
      });
      box.appendChild(det);
    });
    $("#scoreTotal").textContent = total + "点";
  }
  // 計画地の写真（Googleストリートビュー）: 外観（計画地の方向）と前面の通り（道路に沿った方向）
  const brg = (y1, x1, y2, x2) => { const p1 = y1 * Math.PI / 180, p2 = y2 * Math.PI / 180, dl = (x2 - x1) * Math.PI / 180;
    return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * 180 / Math.PI + 360) % 360; };
  async function sitePhotos(lat, lon) {
    if (!USE_GOOGLE || !window.google) return [];
    const { StreetViewService, StreetViewSource } = await google.maps.importLibrary("streetView");
    const sv = new StreetViewService();
    for (const radius of [40, 80, 150]) {
      try {
        // Google公式の道路の写真だけ（お店などが投稿した店内の写真は使わない）
        const r = await sv.getPanorama({ location: { lat, lng: lon }, radius, sources: [StreetViewSource.GOOGLE || StreetViewSource.OUTDOOR] });
        if (!/Google/.test(r.data.copyright || "") || !(r.data.links || []).length) continue;
        const ll = r.data.location.latLng, pano = encodeURIComponent(r.data.location.pano), hd = brg(ll.lat(), ll.lng(), lat, lon);
        const lk = (r.data.links || []).map((l) => l.heading).filter((h) => h != null);
        const off = (a) => Math.abs(((a - hd + 540) % 360) - 180) - 90;
        const along = lk.length ? lk.reduce((b, h) => (Math.abs(off(h)) < Math.abs(off(b)) ? h : b)) : (hd + 90) % 360;
        const u = (h, fov) => `https://maps.googleapis.com/maps/api/streetview?size=640x420&pano=${pano}&heading=${h.toFixed(0)}&fov=${fov}&pitch=2&key=${encodeURIComponent(CFG.googleApiKey)}`;
        const list = [{ label: "外観", url: u(hd, 75) }, { label: "前面の通り", url: u(along, 85) }];
        await Promise.all(list.map(async (x) => { const res = await fetch(x.url); if (res.ok) x.data = new Uint8Array(await res.arrayBuffer()); x.attr = "Googleストリートビュー"; }));
        return list.filter((x) => x.data);
      } catch (e) { /* 次の半径で */ }
    }
    return [];
  }
  const photosFor = () => { if (!cur) return Promise.resolve([]); if (!cur.photoP) cur.photoP = sitePhotos(cur.lat, cur.lon).catch(() => []); return cur.photoP; };

  function planData() {
    const e = estimate(), [r1, r2] = radii(), [g, gl] = GRADES[e.grade];
    const k1 = sumWithin(1), k2 = sumWithin(2), ring1 = sumWithin(r1), ring2 = sumWithin(r2, r1), h05 = sumWithin(0.5).hh;
    const live = cur.comps.filter((c) => !c.closed);
    const n = (km) => live.filter((c) => c.km <= km).length;
    const single = k1.single / Math.max(1, k1.hh);
    const sales = e.lo || e.hi;
    const spec = SPEC_DEF.map((d) => ({ label: d.label, choice: d.opts[S[d.k]][0], pt: specPt(d) }));
    if (S.road === 1) for (const [k, t] of ROAD_OK) spec.push({ label: "幹線道路の必須条件: " + t, choice: S[k] ? "はい" : "いいえ", pt: 0 });
    const cond = e.cond.map((c) => ({ label: c.label, value: c.value,
      note: c.extra ? (c.up ? c.upText : c.keepText) : c.pos < 0 ? c.low : c.pos > 0 ? c.high : "直営店の範囲内" }));
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
    if (S.park > 0 && S.parkEase) st.push("反対車線からも駐車場に出入りしやすい");
    if (S.rival === 0) st.push("500m以内に大型店や新しい競合店がない");
    if (single >= APT_RATIO) st.push("マンションが多く、コインランドリーを使う世帯が多い地域");
    st.push("ランドリープレスの運営ノウハウ（清潔な店内・明るい照明・キャッシュレス対応）");
    const rk = [];
    if (S.rival === 1) rk.push("近くの競合店 → 清潔さ・機械の新しさ・大型機の訴求で差別化する");
    if (S.road === 1) rk.push("幹線道路沿いで入りにくい → 看板・誘導で入口をわかりやすくする");
    if (specPt(SPEC_DEF.find((d) => d.k === "park")) < 0) rk.push("駐車場が少ない → 近隣のお客さん（歩き・自転車）を中心に集客する");
    if (S.see === 0) rk.push("見つけにくい・夜が暗い → 看板・照明・防犯カメラで入りやすくする");
    if (e.base > 0) rk.push("直営店と条件が違う商圏 → 開業後の売上を毎月確認し、早めに手を打つ");
    rk.push("天候・季節で売上が上下する → 梅雨・花粉・冬の布団洗いの時期に集中して宣伝する");
    rk.push("機械の故障 → 保守契約を結び、止まる時間を短くする");
    return {
      address: cur.address, matched: cur.matched, lat: cur.lat, lon: cur.lon,
      created: new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" }),
      mode: "forecast",
      areaRows: [{ label: `第1商圏（半径${r1}km）`, ...ring1, sum: true }, { label: `第2商圏（${r1}〜${r2}km）`, ...ring2, sum: true },
        { label: "参考: 500m以内", ...sumWithin(0.5) }, { label: "参考: 1km以内", ...k1 }, { label: "参考: 2km以内", ...k2 }],
      bands: [["0〜500m", h05], ["500m〜1km", sumWithin(1, 0.5).hh], ["1〜2km", sumWithin(2, 1).hh]],
      zone: zoneText(), score: scoreData(),
      keikaku: { client: planIn.client || "", invest: +planIn.invest2 > 0 ? +planIn.invest2 : 0, area: Math.round([10, 12.5, 17.5, 22.5, 27.5, 32.5, 37.5][S.tsubo] * 3.3058 * 10) / 10, park: [0, 3, 5, 7, 10, 11][S.park] },
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
      if (!window.OpenNaviPlan) await loadScript("plan.js?v=7");
      if (!window.OpenNaviKeikaku) await loadScript("keikaku.js?v=3");
      const d = planData();
      d.photos = await photosFor();
      const blob = await window.OpenNaviKeikaku.makeKeikaku(d);
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
  // スマホで見る事業計画書（その場で画面に出す。PDFは印刷から保存）
  $("#planViewBtn").addEventListener("click", async () => {
    if (!cur) return;
    const msg = $("#planMsg");
    document.querySelectorAll("#planFields input").forEach((i) => i.dispatchEvent(new Event("change")));
    try {
      if (!window.OpenNaviPlan) await loadScript("plan.js?v=7");
      if (!window.OpenNaviKeikaku) await loadScript("keikaku.js?v=3");
      const d = planData(); d.photos = await photosFor();
      showPlanView(d);
    } catch (err) { console.error(err); msg.textContent = "うまく作れませんでした。もう一度お試しください。"; }
  });
  function showPlanView(d) {
    // エクセル（事業計画書）と同じ計算を使う
    const c = window.OpenNaviKeikaku.build(d).calc, A = d.inputs, Y = c.Y;
    const h = (t) => String(t).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m]);
    const m4 = (v) => { const x = Math.round(v); return (x < 0 ? "−" : "") + Math.abs(x).toLocaleString("ja-JP"); };
    const mn = (v) => m4(v / 1e4);
    const show = [0, 1, 2, 4, 9];
    const row = (label, k, strong) => `<tr${strong ? ' class="pv-strong"' : ""}><th>${label}</th>${show.map((i) => `<td class="${Y[i][k] < 0 ? "neg" : ""}">${m4(Y[i][k])}</td>`).join("")}</tr>`;
    const list = (t, txt) => { const it = String(txt || "").split("。").map((x) => x.trim()).filter(Boolean); return it.length ? `<h2>${t}</h2><ul class="pv-list">${it.map((x) => `<li>${h(x)}</li>`).join("")}</ul>` : ""; };
    const areas = d.areaRows.filter((r) => r.sum).map((r) => `<li><span>${h(r.label)}</span><b>${fmt(r.hh)}<small>世帯</small></b><em>人口 ${fmt(r.pop)}人</em></li>`).join("");
    const ok = Y[2].prof > 0;
    const photos = (d.photos || []).map((x) => ({ src: URL.createObjectURL(new Blob([x.data], { type: "image/jpeg" })), label: x.label, attr: x.attr || "" }));
    const box = document.createElement("div"); box.id = "planView"; box.className = "pv";
    box.innerHTML = `
      <div class="pv-bar"><button type="button" class="btn ghost" data-a="close">閉じる</button><button type="button" class="btn" data-a="pdf" disabled>PDFを準備中…</button></div>
      <article class="pv-doc">
        <header class="pv-hero"><p class="pv-eye">BUSINESS PLAN</p><h1>事業計画書</h1><p class="pv-name">${h(A.name)}</p>
          <p class="pv-sub">${h(d.address)}${A.open ? "　開業予定 " + h(A.open) : ""}${planIn.client ? "<br>" + h(planIn.client) + "　御中" : ""}</p></header>
        <section class="pv-kpi">
          <div><span>予測月商（開業3年目）</span><b>${mn(c.sales)}<small>万円</small></b><small>${h(d.est.mark)} ${h(d.est.markText)}（${h(d.est.bandText)}）</small></div>
          <div><span>初期投資（税込）</span><b>${mn(c.invT)}<small>万円</small></b><small>機械・工事・内装の合計</small></div>
          <div><span>1日の利用見込み</span><b>${Math.round(c.sales / A.price / 30)}<small>回</small></b><small>1回${fmt(A.price)}円換算</small></div>
          <div><span>累計黒字化</span><b>${c.payback ? c.payback + "<small>年目</small>" : "—"}</b><small>返済・家賃を差し引き後</small></div>
          <div><span>10年間の累計手残り</span><b class="${c.cum10 < 0 ? "neg" : ""}">${m4(c.cum10)}<small>万円</small></b><small>借入10年返済で試算</small></div>
        </section>
        <p class="pv-judge ${ok ? "ok" : "ng"}">${ok ? "3年目は月" + m4(Y[2].prof / 12) + "万円の手残りが見込めます" : "3年目も手残りがマイナスです"}<small>赤字にならない月の売上は${m4(c.be)}万円（予測の${Math.round(c.be * 1e4 / c.sales * 100)}%）です</small></p>
        <h2>収支計画<small>単位：万円</small></h2>
        <table class="pv-tbl"><thead><tr><th></th><th>初年度</th><th>2年目</th><th>3年目</th><th>5年目</th><th>10年目</th></tr></thead><tbody>
          ${row("売上", "rev", true)}${row("ランニングコスト", "cost")}${row("家賃", "rnt")}${row("借入返済（機械・工事）", "l1")}${row("借入返済（内装・電気）", "l2")}${row("スマラン他", "f")}
          ${row("手残り", "prof", true)}${row("手残りの累計", "cum", true)}
        </tbody></table>
        <p class="pv-note">売上は${h(A.salesNote)}を使っています。初年度80%、2年目92%、3年目100%、4年目109%、5年目以降111%（当社直営店の平均的な立ち上がり）。初期投資の全額を借り入れると仮定しています。</p>
        <h2>もしもの試算<small>単位：万円</small></h2>
        <table class="pv-tbl"><thead><tr><th></th><th>3年目の月の手残り</th><th>10年累計</th></tr></thead><tbody>
          ${c.scen.map((x) => `<tr><th>${h(x.name)}</th><td class="${x.m3p < 0 ? "neg" : ""}">${m4(x.m3p)}</td><td class="${x.cum < 0 ? "neg" : ""}">${m4(x.cum)}</td></tr>`).join("")}
        </tbody></table>
        ${photos.length ? `<h2>計画地の様子</h2><div class="pv-photos">${photos.map((x) => `<figure><img src="${x.src}" alt="${h(x.label)}"><figcaption>${h(x.label)}<small>${h(x.attr)}</small></figcaption></figure>`).join("")}</div>` : ""}
        <h2>立地スコア<small>100点満点</small></h2>
        <div class="pv-score"><b>${c.scoreSum}<small>点</small></b><ul>${c.catTot.map((x) => `<li><span>${h(x.name)}</span><i style="--w:${Math.max(0, Math.min(100, x.v / 30 * 100))}%"></i><em>${x.v}</em></li>`).join("")}</ul></div>
        <h2>商圏</h2><ul class="pv-area">${areas}</ul>
        <p class="pv-note">${h(d.zone ? "用途地域：" + d.zone : "")}</p>
        <p class="pv-note">${h(d.compText || "")}</p>
        <h2>初期投資と借入</h2>
        <dl class="pv-dl"><dt>初期投資（税込）</dt><dd>${mn(c.invT)}万円</dd><dt>月々の返済</dt><dd>${mn(c.pay1 + c.pay2)}万円（10年・年3%）</dd><dt>家賃（月）</dt><dd>${mn(A.rent)}万円</dd><dt>機械構成</dt><dd>洗濯乾燥機${c.counts.wd}台・乾燥機${c.counts.dr}台・洗濯機${c.counts.wa}台</dd><dt>競合への強さ</dt><dd>${c.defLv}（約${c.tsubo.toFixed(1)}坪）</dd></dl>
        ${list("強み", d.strengths)}${list("リスクと対策", d.risks)}
        <footer class="pv-foot">ランドリーオープンナビ　｜　売上の見込みはランドリープレスの売上実績をもとに算出　｜　人口・世帯数は令和2年国勢調査　｜　作成日 ${h(d.created || "")}　｜　機械構成・工事費などの細かい数字はエクセルで変えられます</footer>
      </article>`;
    document.getElementById("planView")?.remove();
    document.body.appendChild(box); document.body.classList.add("pv-open");
    const y0 = window.scrollY; box.scrollTop = 0;
    // PDFは開いたときに先に作っておく（ボタンを押してすぐ共有シートを出すため。ホーム画面のアプリでは印刷が開かない）
    const sp = (t) => String(t || "").split("。").map((x) => x.trim()).filter(Boolean);
    const tr = (label, k, strong) => ({ cells: [label, ...show.map((i) => m4(Y[i][k]))], strong, neg: [false, ...show.map((i) => Y[i][k] < 0)] });
    const blocks = [
      { t: "hero", eye: "BUSINESS PLAN", title: "事業計画書", name: A.name, sub: [d.address + (A.open ? "　開業予定 " + A.open : ""), ...(planIn.client ? [planIn.client + "　御中"] : [])] },
      { t: "kpi", items: [
        { label: "予測月商（開業3年目）", value: mn(c.sales), unit: "万円", note: `${d.est.mark} ${d.est.markText}（${d.est.bandText}）` },
        { label: "初期投資（税込）", value: mn(c.invT), unit: "万円", note: "機械・工事・内装の合計" },
        { label: "1日の利用見込み", value: String(Math.round(c.sales / A.price / 30)), unit: "回", note: `1回${fmt(A.price)}円換算` },
        { label: "累計黒字化", value: c.payback ? String(c.payback) : "—", unit: c.payback ? "年目" : "", note: "返済・家賃を差し引き後" },
        { label: "10年間の累計手残り", value: m4(c.cum10), unit: "万円", note: "借入10年返済で試算" }] },
      { t: "judge", ok, text: ok ? "3年目は月" + m4(Y[2].prof / 12) + "万円の手残りが見込めます" : "3年目も手残りがマイナスです", sub: `赤字にならない月の売上は${m4(c.be)}万円（予測の${Math.round(c.be * 1e4 / c.sales * 100)}%）です` },
      { t: "h2", text: "収支計画", small: "単位：万円", keep: 560 },
      { t: "table", head: ["", "初年度", "2年目", "3年目", "5年目", "10年目"], widths: [0.3, 0.14, 0.14, 0.14, 0.14, 0.14], lastAccent: true,
        rows: [tr("売上", "rev", true), tr("ランニングコスト", "cost"), tr("家賃", "rnt"), tr("借入返済（機械・工事）", "l1"), tr("借入返済（内装・電気）", "l2"), tr("スマラン他", "f"), tr("手残り", "prof", true), tr("手残りの累計", "cum", true)] },
      { t: "note", text: `売上は${A.salesNote}を使っています。初年度80%、2年目92%、3年目100%、4年目109%、5年目以降111%（当社直営店の平均的な立ち上がり）。初期投資の全額を借り入れると仮定しています。` },
      { t: "h2", text: "もしもの試算", small: "単位：万円", keep: 120 + c.scen.length * 50 },
      { t: "table", head: ["", "3年目の月の手残り", "10年累計"], widths: [0.5, 0.25, 0.25], rows: c.scen.map((x) => ({ cells: [x.name, m4(x.m3p), m4(x.cum)], neg: [false, x.m3p < 0, x.cum < 0] })) },
      ...(photos.length ? [{ t: "h2", text: "計画地の様子", keep: 480 }, { t: "photos", items: photos }] : []),
      { t: "h2", text: "立地スコア", small: "100点満点", keep: 120 + c.catTot.length * 40 },
      { t: "score", total: String(c.scoreSum), items: c.catTot.map((x) => ({ name: x.name, v: String(x.v), w: Math.max(0, Math.min(1, x.v / 30)) })) },
      { t: "h2", text: "商圏", keep: 300 },
      { t: "cards", items: d.areaRows.filter((r) => r.sum).map((r) => ({ label: r.label, value: fmt(r.hh), unit: "世帯", sub: `人口 ${fmt(r.pop)}人` })) },
      { t: "note", text: d.zone ? "用途地域：" + d.zone : "" }, { t: "note", text: d.compText || "" },
      { t: "h2", text: "初期投資と借入", keep: 340 },
      { t: "dl", items: [["初期投資（税込）", mn(c.invT) + "万円"], ["月々の返済", mn(c.pay1 + c.pay2) + "万円（10年・年3%）"], ["家賃（月）", mn(A.rent) + "万円"], ["機械構成", `洗濯乾燥機${c.counts.wd}台・乾燥機${c.counts.dr}台・洗濯機${c.counts.wa}台`], ["競合への強さ", `${c.defLv}（約${c.tsubo.toFixed(1)}坪）`]] },
      ...(sp(d.strengths).length ? [{ t: "h2", text: "強み", keep: 140 }, { t: "list", items: sp(d.strengths) }] : []),
      ...(sp(d.risks).length ? [{ t: "h2", text: "リスクと対策", keep: 140 }, { t: "list", items: sp(d.risks) }] : []),
      { t: "foot", text: `ランドリーオープンナビ　｜　売上の見込みはランドリープレスの売上実績をもとに算出　｜　人口・世帯数は令和2年国勢調査　｜　作成日 ${d.created || ""}` },
    ];
    const pdfName = `事業計画書_${A.name}.pdf`.replace(/[\\/:*?"<>|]/g, "_");
    const pdfBtn = box.querySelector('[data-a="pdf"]');
    const pdfP = (window.OpenNaviPdf ? Promise.resolve() : loadScript("pvpdf.js?v=1")).then(() => window.OpenNaviPdf.make(blocks, { footer: A.name }));
    pdfP.then(() => { pdfBtn.disabled = false; pdfBtn.textContent = "PDFで保存"; }, (e) => { console.error(e); pdfBtn.disabled = false; pdfBtn.textContent = "PDFで保存"; });
    box.addEventListener("click", async (ev) => {
      const a = ev.target.closest("[data-a]")?.dataset.a;
      if (a === "close") { box.remove(); document.body.classList.remove("pv-open"); window.scrollTo(0, y0); }
      if (a === "pdf") {
        let blob = null; try { blob = await pdfP; } catch (e) { blob = null; }
        if (blob) await window.OpenNaviPdf.save(blob, pdfName); else window.print();
      }
    });
  }
  renderPlanForm();

  $("#specReset")?.addEventListener("click", () => { S = { ...SPEC0 }; store.set("spec5", S); CK = {}; store.set("check1", CK); renderSpec(); if (cur) { renderVerdict(); renderPrint(); } });
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
    renderVerdict(); renderStats(); renderZone(); renderList(); renderPrint(); map.draw(fit);
  }

  // ---------------------------------------------------------------- A4印刷用
  const NEAR = 3, TABLE_MAX = 8;
  function renderPrint() {
    const [r1, r2] = radii(), d = new Date();
    $("#pmeta").textContent = `候補地: ${cur.address}　｜　第1商圏 ${r1}km・第2商圏 ${r2}km　｜　作成日 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    $("#psrc").textContent = `売上の見込み: ランドリープレスの売上実績をもとに算出（客単価${fmt(P.price)}円）　｜　人口・世帯数: 令和2年国勢調査500mメッシュ　｜　` + $("#srcnote").textContent;
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
      if (cur.nearAuto) { S.near = cur.nearAuto.name ? 1 : 0; store.set("spec5", S); }
      // 参考チェック: 場所によって変わる項目は、新しい住所では選び直し。生活の通り道は自動で入れる
      for (const d of CHECK_DEF) if (d.place) CK[d.k] = 0;
      [cur.chkAuto, cur.zone] = await Promise.all([checkAuto(g.lat, g.lon).catch(() => null), zoneSurvey(g.lat, g.lon).catch(() => null)]);
      if (cur.chkAuto) CK.route = cur.chkAuto.route ? 1 : 2;
      store.set("check1", CK);
      SC = null; store.set("score1", null);
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
