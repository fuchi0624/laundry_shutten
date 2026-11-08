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
  // ---------------------------------------------------------------- 来店客数の見込み
  // 計算の前提（画面の「計算の前提」で変えられる。この端末に保存）
  const PARAM_DEF = [
    ["rate1", "来店率（第1商圏）", "%", 5, 0.1],
    ["rate2", "来店率（第2商圏）", "%", 2, 0.1],
    ["freq1", "月の利用回数（第1商圏）", "回", 2, 0.1],
    ["freq2", "月の利用回数（第2商圏）", "回", 1, 0.1],
    ["wSingle", "単身世帯の使いやすさ", "倍", 1.5, 0.1],
    ["wKids", "子育て世帯の使いやすさ", "倍", 1.5, 0.1],
    ["price", "客単価", "円", 900, 50],
    ["good", "「おすすめ」の目安（月の売上）", "万円以上", 150, 5],
    ["ok", "「検討」の目安（月の売上）", "万円以上", 80, 5],
  ];
  const PARAM0 = Object.fromEntries(PARAM_DEF.map((d) => [d[0], d[3]]));
  let P = { ...PARAM0, ...(store.get("params") || {}) };

  // 世帯数を「使いやすさ」で重み付け（単身・子育て世帯は多めに数える）
  const weightedHH = (hh, single, kids) => single * P.wSingle + kids * P.wKids + Math.max(0, hh - single - kids);

  // 来店客数の見込み。商圏の中を細かい点に分け、点ごとに
  //   自店の取り分 = 1 ÷ (1 + Σ 他社の重み ×(自店までの距離 ÷ 他社までの距離)²)
  // で近くの他社に取られる分を差し引く（近い店ほどお客さんを取りやすい）。
  // 商圏ごとの「重み付き世帯数」と、そのうち自店が取れる分（来店率・回数を掛ける前）
  function capture(site, r1, r2) {
    const lo = Math.min(r1, r2);
    const kx = 111.32 * Math.cos(site.lat * Math.PI / 180), ky = 110.57;
    // 要確認の店は半分、臨時休業中の店は数えない
    const rivals = site.comps.filter((c) => !c.closed).map((c) => ({ x: (c.lon - site.lon) * kx, y: (c.lat - site.lat) * ky, w: c.unsure ? 0.5 : 1 }));
    const MIN = 0.2; // 0.2km より近い距離は 0.2km とみなす
    return [[0, r1], [lo, r2]].map(([rIn, rOut]) => {
      let market = 0, own = 0;
      for (const c of site.cells) {
        const [, hh, single, kids] = c.v, per = weightedHH(hh, single, kids) / c.d.length;
        if (!per) continue;
        for (let k = 0; k < c.d.length; k++) {
          const d = c.d[k]; if (d <= rIn || d > rOut) continue;
          const x = c.xy[2 * k], y = c.xy[2 * k + 1], d0 = Math.max(d, MIN) ** 2;
          let sum = 0;
          for (const r of rivals) sum += r.w * d0 / Math.max(Math.hypot(x - r.x, y - r.y), MIN) ** 2;
          market += per; own += per / (1 + sum);
        }
      }
      return { market, own };
    });
  }
  // 重み付き世帯 → 月の来店客数
  const visits = (cap) => [cap[0].own * P.rate1 / 100 * P.freq1, cap[1].own * P.rate2 / 100 * P.freq2];
  function estimate() {
    const [r1, r2] = radii(), cap = capture(cur, r1, r2), v = visits(cap);
    const rings = [{ own: v[0] }, { own: v[1] }];
    const month = v[0] + v[1], market = cap[0].market * P.rate1 / 100 * P.freq1 + cap[1].market * P.rate2 / 100 * P.freq2;
    const sales = month * P.price;
    const grade = sales >= P.good * 1e4 ? 0 : sales >= P.ok * 1e4 ? 1 : 2;
    return { rings, month, day: month / 30, sales, share: market ? month / market : 1, grade };
  }
  // 直営店13店の実績: 開業1年目は3年目の約80%、2年目は約92%
  const RAMP = [0.8, 0.92];
  const GRADES = [["◎", "おすすめ", "g0"], ["○", "検討の余地あり", "g1"], ["△", "慎重に", "g2"]];
  const man = (yen) => (yen / 1e4 >= 100 ? fmt(yen / 1e4) : (Math.round(yen / 1e3) / 10).toLocaleString("ja-JP"));

  // 判定の理由（短い文で3つまで）
  function reasons(e) {
    const [r1] = radii(), s = sumWithin(r1), out = [];
    const n1 = cur.comps.filter((c) => c.km <= r1 && !c.closed).length;
    const ratio = s.hh ? (s.single + s.kids) / s.hh : 0;
    out.push(`第1商圏の世帯数は${fmt(s.hh)}世帯${s.hh >= 5000 ? "で多め" : s.hh >= 2000 ? "で標準的" : "で少なめ"}です。`);
    out.push(`単身・子育て世帯が${Math.round(ratio * 100)}%${ratio >= 0.5 ? "と多く、利用が見込めます" : ratio >= 0.4 ? "で平均的です" : "と少なめです"}。`);
    out.push(n1 ? `第1商圏に他社が${n1}店あり、お客さんの取り分は約${Math.round(e.share * 100)}%の見込みです。`
      : `第1商圏に他社が見つからず、お客さんの取り分は約${Math.round(e.share * 100)}%の見込みです。`);
    return out;
  }

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
        add(new G.Circle({ map: this.g, center: { lat, lng: lon }, radius: r2 * 1000, strokeColor: accent, strokeWeight: 2, strokeOpacity: 0.9, fillOpacity: 0, clickable: false }));
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
        L.circle([lat, lon], { radius: r2 * 1000, color: accent, weight: 2, dashArray: "8 6", fill: false }).addTo(this.layer);
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
    box.className = "card verdict " + cls;
    box.innerHTML = `<div class="v-top"><div class="v-grade"><b>${g}</b><span>${gl}</span></div>
      <button type="button" class="btn ghost" id="saveBtn">${isSaved() ? "保存済み ✓" : "この候補地を保存"}</button></div>
      <div class="v-nums">
        <div><span class="label">来店客数の見込み</span><span class="value">${fmt(e.day)}</span><span class="unit">人／日</span><small>月 ${fmt(e.month)}人</small></div>
        <div><span class="label">月の売上の目安</span><span class="value">${man(e.sales)}</span><span class="unit">万円</span><small>年 ${man(e.sales * 12)}万円</small></div>
      </div>
      <ul class="v-why"></ul>
      <p class="v-ramp">開業1年目は約<b>${man(e.sales * RAMP[0])}</b>万円／月、2年目は約<b>${man(e.sales * RAMP[1])}</b>万円／月から（直営店の伸び方より）</p>
      <p class="v-note">軌道に乗った後（3年目）の目安です。第1商圏から月${fmt(e.rings[0].own)}人・第2商圏から月${fmt(e.rings[1].own)}人の見込み。客単価${fmt(P.price)}円で計算。前提はページ下の「計算の前提」で変えられます。</p>`;
    const ul = box.querySelector(".v-why");
    reasons(e).forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
    $("#saveBtn").addEventListener("click", saveCurrent);
    $("#pverdict").innerHTML = `<b class="${cls}">${g}</b><div><span>${gl}</span><p>来店 1日約<strong>${fmt(e.day)}</strong>人　売上 月約<strong>${man(e.sales)}</strong>万円</p></div>`;
  }

  // ---------------------------------------------------------------- 候補地の保存と比較
  const savedKey = () => { const [r1, r2] = radii(); return `${cur.address}|${r1}|${r2}`; };
  const isSaved = () => (store.get("saved") || []).some((x) => x.key === savedKey());
  function saveCurrent() {
    const [r1, r2] = radii(), e = cur.est, s = sumWithin(r1);
    const list = (store.get("saved") || []).filter((x) => x.key !== savedKey());
    list.unshift({
      key: savedKey(), address: cur.address, r1, r2, grade: e.grade, day: e.day, sales: e.sales, share: e.share,
      hh1: s.hh, n1: cur.comps.filter((c) => c.km <= r1).length, n2: cur.comps.filter((c) => c.km > Math.min(r1, r2) && c.km <= r2).length,
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
    const best = Math.max(...list.map((x) => x.sales));
    list.forEach((x, i) => {
      const [g, gl, cls] = GRADES[x.grade];
      const li = document.createElement("li");
      li.className = "cmp" + (list.length > 1 && x.sales === best ? " best" : "");
      li.innerHTML = `<div class="cmp-head"><b class="cmp-grade ${cls}">${g}</b><button type="button" class="cmp-name"></button>
        <button type="button" class="cmp-del" aria-label="削除">×</button></div>
        <dl class="cmp-nums">
          <div><dt>来店／日</dt><dd>${fmt(x.day)}<small>人</small></dd></div>
          <div><dt>売上／月</dt><dd>${man(x.sales)}<small>万円</small></dd></div>
          <div><dt>第1商圏の世帯</dt><dd>${fmt(x.hh1)}</dd></div>
          <div><dt>他社 第1／第2</dt><dd>${x.n1}<small>／</small>${x.n2}<small>店</small></dd></div>
        </dl><p class="cmp-sub">${x.r1}km・${x.r2}km で計算${list.length > 1 && x.sales === best ? "　｜　この中で一番売上が見込めます" : ""}</p>`;
      li.querySelector(".cmp-name").textContent = x.address;
      li.querySelector(".cmp-name").onclick = () => {
        $("#addr").value = x.address; $("#r1").value = x.r1; $("#r2").value = x.r2;
        window.scrollTo({ top: 0, behavior: "smooth" }); run(x.address);
      };
      li.querySelector(".cmp-del").onclick = () => {
        store.set("saved", (store.get("saved") || []).filter((y) => y.key !== x.key));
        renderCompare(); if (cur) $("#saveBtn").textContent = isSaved() ? "保存済み ✓" : "この候補地を保存";
      };
      ol.appendChild(li);
    });
  }

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

  // ---------------------------------------------------------------- 直営店の実績で合わせる
  // Excel（.xlsx）を外部の部品なしで読む。ファイルは端末の中だけで使い、どこにも送らない。
  async function readXlsx(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
    let e = buf.byteLength - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("Excelファイルとして読めませんでした。");
    const files = {}; let p = dv.getUint32(e + 16, true);
    for (let i = 0, n = dv.getUint16(e + 10, true); i < n; i++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      files[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = { method, size, off };
      p += 46 + nl + xl + cl;
    }
    async function text(name) {
      const f = files[name]; if (!f) return null;
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      const raw = u8.subarray(start, start + f.size);
      if (f.method === 0) return dec.decode(raw);
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).text();
    }
    const xml = (t) => new DOMParser().parseFromString(t, "application/xml");
    const ss = [...xml((await text("xl/sharedStrings.xml")) || "<sst/>").getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
    const wb = xml(await text("xl/workbook.xml")), rels = xml(await text("xl/_rels/workbook.xml.rels"));
    const sheets = [...wb.getElementsByTagName("sheet")];
    const sh = sheets.find((x) => /マスタ/.test(x.getAttribute("name"))) || sheets[0];
    const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = [...rels.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid).getAttribute("Target").replace(/^\/?(xl\/)?/, "xl/");
    const rows = [];
    for (const c of xml(await text(target)).getElementsByTagName("c")) {
      const [, col, row] = c.getAttribute("r").match(/([A-Z]+)(\d+)/), t = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0], is = c.getElementsByTagName("t")[0];
      let val = t === "s" ? ss[+v.textContent] : t === "inlineStr" ? is && is.textContent : v ? v.textContent : null;
      if (val != null && t !== "s" && t !== "inlineStr" && t !== "str" && val !== "" && !isNaN(+val)) val = +val;
      (rows[+row] = rows[+row] || {})[col] = val;
    }
    return rows;
  }
  // 開業年月 → 開業からの月数（"2018/03" や Excel の日付どちらでも）
  function monthsOpen(v) {
    let y, m;
    if (typeof v === "number") { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); y = d.getUTCFullYear(); m = d.getUTCMonth() + 1; }
    else { const r = String(v || "").match(/(\d{4})\D+(\d{1,2})/); if (!r) return null; y = +r[1]; m = +r[2]; }
    const now = new Date(); return (now.getFullYear() - y) * 12 + now.getMonth() + 1 - m;
  }
  let calib = null;
  async function runCalib(file) {
    const out = $("#calibOut"), btn = $("#calibPick");
    const say = (t, err) => { out.innerHTML = ""; const p = document.createElement("p"); p.className = "note" + (err ? " err" : ""); p.textContent = t; out.appendChild(p); };
    btn.classList.add("busy");
    try {
      const rows = await readXlsx(await file.arrayBuffer());
      const stores = rows.filter((r) => r && typeof r.C === "number" && r.D && /店/.test(r.A || ""))
        .map((r) => ({ name: String(r.A).replace(/Laundry Press\s*/i, ""), address: String(r.D).replace(/〒\d{3}-?\d{4}\s*/, "").trim(), sales: r.C, months: monthsOpen(r.B) }));
      if (!stores.length) throw new Error("店舗名・住所・平均月商が入った行が見つかりませんでした。");
      const used = stores.filter((s) => s.months == null || s.months >= 24), skipped = stores.length - used.length;
      const [r1, r2] = radii(), searchKm = Math.max(r2, 3);
      await mapReady;
      for (let i = 0; i < used.length; i++) {
        const s = used[i];
        say(`${i + 1}／${used.length}店目（${s.name}）の人口と他社を調べています…`);
        try {
          const g = await geocode(s.address.replace(/\s.*$/, ""));
          const [cells, cres] = await Promise.all([buildCells(g.lat, g.lon), (USE_GOOGLE ? compsGoogle : compsOSM)(g.lat, g.lon, searchKm).catch(() => ({ comps: [] }))]);
          // 自分の店は他社から除く（候補地から50m以内の店）
          const comps = cres.comps.filter((c) => c.km > 0.05);
          Object.assign(s, { lat: g.lat, lon: g.lon, cells, comps, n1: comps.filter((c) => c.km <= r1).length });
          s.cap = capture(s, r1, r2);
        } catch (e) { s.err = true; }
      }
      const ok = used.filter((s) => s.cap);
      if (ok.length < 3) throw new Error("調べられた店が少なすぎました。通信環境を確認して、もう一度お試しください。");
      // 第1商圏・第2商圏の来店率をそれぞれ、予測と実績のずれ（割合）が一番小さくなるように決める
      const x = (s) => [s.cap[0].own / 100 * P.freq1 * P.price, s.cap[1].own / 100 * P.freq2 * P.price];
      const pred = (s, r) => { const [a, b] = x(s); return a * r[0] + b * r[1]; };
      const err = (r) => ok.reduce((a, s) => a + Math.abs(pred(s, r) - s.sales) / s.sales, 0) / ok.length;
      let A = 0, B = 0, C = 0, D = 0, E = 0;
      for (const s of ok) { const [a, b] = x(s), w = 1 / s.sales ** 2; A += w * a * a; B += w * a * b; C += w * b * b; D += w * a * s.sales; E += w * b * s.sales; }
      const det = A * C - B * B;
      let fit = det > 0 ? [(D * C - B * E) / det, (A * E - B * D) / det] : null;
      if (!fit || fit[0] < 0 || fit[1] < 0) { // どちらかがマイナスになるときは、今の比率のまま倍率だけ合わせる
        const k = (D * P.rate1 + E * P.rate2) / (A * P.rate1 ** 2 + 2 * B * P.rate1 * P.rate2 + C * P.rate2 ** 2);
        fit = [P.rate1 * k, P.rate2 * k];
      }
      fit = fit.map((v) => Math.round(v * 100) / 100);
      const cur0 = [P.rate1, P.rate2];
      calib = { r1, r2, ok, skipped, fit, before: err(cur0), after: err(fit), rate1: fit[0], rate2: fit[1] };
      renderCalib(pred);
    } catch (e) {
      say(e.message || "うまく読み込めませんでした。", true);
    } finally { btn.classList.remove("busy"); $("#calibFile").value = ""; }
  }
  function renderCalib(pred) {
    const c = calib, out = $("#calibOut");
    out.innerHTML = `<div class="calib-sum">
        <p>開業2年以上の<b>${c.ok.length}店</b>で合わせました${c.skipped ? `（開業2年未満の${c.skipped}店は、まだ売上が伸びている途中なので除外）` : ""}。</p>
        <p>予測と実績のずれ（平均）: <b>${Math.round(c.before * 100)}%</b> → <b class="good">${Math.round(c.after * 100)}%</b></p>
        <p>来店率: 第1商圏 ${P.rate1}% → <b>${c.rate1}%</b>、第2商圏 ${P.rate2}% → <b>${c.rate2}%</b>（第${c.r1}km・${c.r2}kmで計算）</p>
      </div>
      <div class="calib-table"><table><thead><tr><th>店</th><th>他社<br><small>第1商圏</small></th><th>実績</th><th>予測</th><th>ずれ</th></tr></thead><tbody></tbody></table></div>
      <div class="set-actions"><button type="button" class="btn" id="calibApply">この来店率を使う</button></div>
      <p class="note">「この来店率を使う」は、この端末だけに反映されます。社員みんなの初期値にするときは、この画面のスクリーンショットを送ってください。</p>`;
    const tb = out.querySelector("tbody");
    for (const s of [...c.ok].sort((a, b) => b.sales - a.sales)) {
      const pv = pred(s, c.fit), gap = (pv - s.sales) / s.sales, tr = document.createElement("tr");
      [s.name, s.n1 + "店", man(s.sales) + "万", man(pv) + "万", (gap > 0 ? "+" : "") + Math.round(gap * 100) + "%"].forEach((v, i) => {
        const td = document.createElement("td"); td.textContent = v;
        if (i === 4 && Math.abs(gap) > 0.3) td.className = "far";
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }
    $("#calibApply").onclick = () => {
      P.rate1 = c.rate1; P.rate2 = c.rate2; store.set("params", P); renderSettings();
      if (cur) { renderVerdict(); renderPrint(); }
      $("#calibApply").textContent = "反映しました ✓";
    };
  }
  $("#calibFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) runCalib(f); });

  function renderList() {
    const [r1, r2] = radii(), ol = $("#list");
    ol.textContent = "";
    if (!cur.comps.length) { const li = document.createElement("li"); li.className = "muted"; li.textContent = "見つかりませんでした。"; ol.appendChild(li); return; }
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
      ol.appendChild(li);
    });
  }
  function select(i, scroll) {
    active = i; map.draw(false); map.focus(cur.comps[i]);
    document.querySelectorAll(".item").forEach((li) => li.classList.toggle("active", +li.dataset.i === i));
    if (scroll) { const el = document.querySelector(`.item[data-i="${i}"]`); el && el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
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
    $("#psrc").textContent = `来店客数: 世帯数×来店率(${P.rate1}%・${P.rate2}%)×月の利用(${P.freq1}回・${P.freq2}回)、単身${P.wSingle}倍・子育て${P.wKids}倍、他社との距離で按分、客単価${fmt(P.price)}円　｜　人口・世帯数: 令和2年国勢調査500mメッシュ　｜　` + $("#srcnote").textContent;
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
      cur = { ...g, address: addr, cells, comps: cres.comps, searchKm };
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
