// 事業計画書（Excel）の作り方。ここ1か所で形を決め、2つの道具で使う（2026-11-09 連携）。
//   ・ランドリーオープンナビ（ブラウザ）: mode "forecast" … 売上はオープンナビの売上予測
//   ・商圏分析と事業計画書の自動作成（shoken.py → node plan_cli.js）: mode "visit" … 売上は来店率×来店頻度の推計
// xlsx は JSZip で XML を固めて作る（外部サービスにデータは送らない）。
(function (root) {
  "use strict";
  const JSZipLib = () => root.JSZip || (typeof require === "function" ? require(root.__JSZIP_PATH || "jszip") : null);

  // ------------------------------------------------------------ 小さな xlsx 書き出し
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const colName = (n) => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  // スタイル番号
  const ST = { n: 0, b: 1, title: 2, h2: 3, head: 4, inText: 5, yen: 6, inYen: 7, inPct: 8, num: 9, bYen: 10, wrap: 11, label: 12, pct: 13, dec2: 14, inNum: 15, bNum: 16, inWrap: 17, note: 18, km: 19, inDec: 20 };
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0&quot;円&quot;"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="0.0&quot;km&quot;"/><numFmt numFmtId="167" formatCode="0.0"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="11"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="18"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="13"/><color rgb="FFE2621B"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>
<font><sz val="9"/><color rgb="FF7F6E61"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>
</fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF2B1E15"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBF1E8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="21">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="9" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  // 見出し行（白文字）は font を足す代わりに、色付きの塗りに太字のまま。読みやすさのため塗りは濃い茶に白…にしたいので font 5 を追加
  const STYLES_FIXED = STYLES
    .replace('<fonts count="5">', '<fonts count="6">')
    .replace('</fonts>', '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font></fonts>')
    .replace('<xf numFmtId="0" fontId="1" fillId="3" borderId="1"', '<xf numFmtId="0" fontId="5" fillId="3" borderId="1"');

  class Sheet {
    constructor(name) { this.name = name; this.rows = new Map(); this.cols = []; this.merges = []; this.grid = true; this.heights = {}; }
    set(ref, v, s = 0, f = null) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref); const r = +m[2];
      if (!this.rows.has(r)) this.rows.set(r, new Map());
      this.rows.get(r).set(m[1], { v, s, f });
      return this;
    }
    width(col, w) { this.cols.push([col, w]); return this; }
    xml() {
      const cols = this.cols.length ? `<cols>${this.cols.map(([c, w]) => { const i = c.charCodeAt(0) - 64; return `<col min="${i}" max="${i}" width="${w}" customWidth="1"/>`; }).join("")}</cols>` : "";
      const rows = [...this.rows.keys()].sort((a, b) => a - b).map((r) => {
        const cells = [...this.rows.get(r).entries()].sort((a, b) => (a[0].length - b[0].length) || (a[0] < b[0] ? -1 : 1)).map(([c, o]) => {
          const ref = c + r, s = o.s ? ` s="${o.s}"` : "";
          const fx = o.f ? `<f>${esc(o.f)}</f>` : "";
          if (o.v == null || o.v === "") return o.f ? `<c r="${ref}"${s}${typeof o.v === "string" ? ' t="str"' : ""}>${fx}</c>` : `<c r="${ref}"${s}/>`;
          if (typeof o.v === "number" && isFinite(o.v)) return `<c r="${ref}"${s}>${fx}<v>${o.v}</v></c>`;
          if (o.f) return `<c r="${ref}"${s} t="str">${fx}<v>${esc(o.v)}</v></c>`;
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
        }).join("");
        const h = this.heights[r] ? ` ht="${this.heights[r]}" customHeight="1"` : "";
        return `<row r="${r}"${h}>${cells}</row>`;
      }).join("");
      const merges = this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"${this.grid ? "" : ' showGridLines="0"'}/></sheetViews><sheetFormatPr defaultRowHeight="18"/>${cols}<sheetData>${rows}</sheetData>${merges}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`;
    }
  }

  async function toBlob(sheets, type = "blob") {
    const Z = JSZipLib(); const zip = new Z();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>事業計画書</dc:title><dc:creator>ランドリーオープンナビ</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`);
    zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
    zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.file("xl/styles.xml", STYLES_FIXED);
    sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml()));
    return zip.generateAsync({ type, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
  }

  // ------------------------------------------------------------ 事業計画書の中身
  const man = (y) => (Math.round(y / 1e4)).toLocaleString("ja-JP") + "万円";
  const yen = (y) => Math.round(y).toLocaleString("ja-JP") + "円";

  function build(d) {
    const A = d.inputs, visit = d.mode === "visit";
    const areaRows = d.areaRows;
    // 前提条件の行（B列）。ここを変えると全シートが計算し直される
    const P = {};
    const items = [
      ["店舗名", A.name, ST.inText],
      ["業種", A.gyoshu || "コインランドリー", ST.inText],
      ["所在地", d.address, ST.inText],
      ["所在地（住所検索の結果）", d.matched, ST.inText],
      ["緯度", +d.lat.toFixed(6), ST.inNum],
      ["経度", +d.lon.toFixed(6), ST.inNum],
      ["開業予定日", A.open || "（未定）", ST.inText],
      ...(visit ? [["推計の対象（世帯 / 人口）", d.visit.base, ST.inText]] : []),
      ["月間営業日数", 30, ST.inNum],
      ["客単価", A.price, ST.inYen],
      ["月の売上（軌道に乗った3年目）", A.sales, visit ? ST.bYen : ST.inYen],
      ["1年目の売上の割合（3年目に対して）", A.ramp ? A.ramp[0] : 0.8, ST.inPct],
      ["2年目の売上の割合", A.ramp ? A.ramp[1] : 0.92, ST.inPct],
      ["3年目の売上の割合", 1, ST.inPct],
      ["変動費率（水道光熱費・洗剤など）", A.varRate, ST.inPct],
      ["清掃・管理の委託費（月）", A.clean, ST.inYen],
      ["地代・家賃（月）", A.rent, ST.inYen],
      ["その他固定費（保守・保険・通信・広告）（月）", A.other, ST.inYen],
      ["初期投資額", A.invest, ST.inYen],
      ["自己資金", A.own, ST.inYen],
      ["借入金", Math.max(0, A.invest - A.own), ST.inYen],
      ["借入金利（年）", A.rate, ST.inPct],
      ["返済期間（年）", A.years, ST.inNum],
      ["減価償却年数", A.dep, ST.inNum],
    ];
    const pre = new Sheet("前提条件").width("A", 46).width("B", 34).width("C", 40);
    pre.set("A1", "前提条件（黄色のセルを変えると、全部のシートが計算し直されます）", ST.title);
    items.forEach(([label, v, s], i) => { const r = 3 + i; pre.set("A" + r, label, ST.label).set("B" + r, v, s); P[label] = { ref: `前提条件!$B$${r}`, v, r }; });
    const n0 = 3 + items.length + 1;
    pre.set("A" + n0, visit
      ? "※月の売上は「来店客数」シートの推計（商圏内の対象数 × 来店率 × 来店頻度 × 客単価）から自動で入ります。費用は実際の見積もり・契約条件に合わせて変えてください。"
      : "※月の売上はランドリーオープンナビの売上予測（ランドリープレスの売上実績をもとに算出）から入れています。費用は実際の見積もり・契約条件に合わせて変えてください。", ST.note);
    pre.merges.push(`A${n0}:C${n0}`); pre.heights[n0] = 48;
    const p = (k) => P[k].ref, pv = (k) => P[k].v;
    // 来店率×来店頻度で売上を出す場合（shoken.py から）: 商圏ごとの来店率・来店頻度の表
    let rateRows = [], visitTot = 0;
    if (visit) {
      const r0 = n0 + 2;
      pre.set("A" + r0, "商圏ごとの来店率・来店頻度", ST.h2);
      ["商圏（ドーナツ状の範囲）", "来店率（対象のうち来店客になる割合）", "来店頻度（回/月）"].forEach((h, i) => pre.set(colName(i) + (r0 + 1), h, ST.head));
      d.visit.rings.forEach((g, k) => {
        const rr = r0 + 2 + k; rateRows.push(rr);
        pre.set("A" + rr, g.label, ST.label).set("B" + rr, g.rate, ST.inPct).set("C" + rr, g.freq, ST.inDec);
      });
      const nn = r0 + 2 + d.visit.rings.length;
      pre.set("A" + nn, "※来店率・来店頻度の初期値は仮置きです。競合店の数、駅・幹線道路からの距離に合わせて調整してください。", ST.note);
      pre.merges.push(`A${nn}:C${nn}`); pre.heights[nn] = 30;
      // 推計（キャッシュ値）
      const byPop = d.visit.base === "人口";
      visitTot = d.visit.rings.reduce((a, g) => a + areaRows[g.row][byPop ? "pop" : "hh"] * g.rate * g.freq, 0);
      P["月の売上（軌道に乗った3年目）"].v = visitTot * pv("客単価");
      const rs = P["月の売上（軌道に乗った3年目）"].r;
      pre.set("B" + rs, Math.round(P["月の売上（軌道に乗った3年目）"].v), ST.bYen, `来店客数!F${5 + d.visit.rings.length}*${p("客単価")}`);
      pre.set("C" + rs, "「来店客数」シートの推計から自動", ST.note);
    }

    // ---- 計算（Excelの数式と同じ計算をして、開いた瞬間から数字が見えるようにする）
    const ramps = ["1年目の売上の割合（3年目に対して）", "2年目の売上の割合", "3年目の売上の割合"];
    const loanAnnual = pv("返済期間（年）") ? pv("借入金") / pv("返済期間（年）") : 0;
    const dep = pv("減価償却年数") ? pv("初期投資額") / pv("減価償却年数") : 0;
    const Y = [0, 1, 2].map((y) => {
      const sales = pv("月の売上（軌道に乗った3年目）") * 12 * pv(ramps[y]);
      const cust = sales / pv("客単価");
      const vc = sales * pv("変動費率（水道光熱費・洗剤など）");
      const gross = sales - vc;
      const fx = [pv("清掃・管理の委託費（月）") * 12, pv("地代・家賃（月）") * 12, pv("その他固定費（保守・保険・通信・広告）（月）") * 12, dep];
      const op = gross - fx.reduce((a, b) => a + b, 0);
      const interest = Math.max(0, pv("借入金") - loanAnnual * y) * pv("借入金利（年）");
      const ord = op - interest;
      return { sales, cust, vc, gross, fx, op, interest, ord, repay: loanAnnual, cf: ord + dep - loanAnnual };
    });
    const fixedSum = Y[0].fx.reduce((a, b) => a + b, 0);
    const vr = pv("変動費率（水道光熱費・洗剤など）");
    const bep = 1 - vr <= 0 ? 0 : fixedSum / (1 - vr);
    const bepDay = bep / pv("客単価") / (pv("月間営業日数") * 12);
    const dayCust3 = pv("月の売上（軌道に乗った3年目）") / pv("客単価") / pv("月間営業日数");

    // ---- 商圏分析
    const area = new Sheet("商圏分析").width("A", 22).width("B", 16).width("C", 16).width("D", 16).width("E", 16).width("F", 16).width("G", 14);
    area.set("A1", "商圏分析（令和2年国勢調査 500mメッシュを商圏の円で按分）", ST.title);
    area.set("A2", `中心: ${d.matched}（緯度 ${d.lat.toFixed(6)} / 経度 ${d.lon.toFixed(6)}）`);
    ["範囲", "人口", "世帯数", "単身世帯", "6歳未満の子がいる世帯", "65歳以上がいる世帯", "平均世帯人員"].forEach((h, i) => area.set(colName(i) + "4", h, ST.head));
    const opt = (v) => (v == null ? "−" : Math.round(v));
    areaRows.forEach((s, i) => {
      const r = 5 + i;
      area.set("A" + r, s.label, ST.label).set("B" + r, Math.round(s.pop), ST.num).set("C" + r, Math.round(s.hh), ST.num)
        .set("D" + r, opt(s.single), ST.num).set("E" + r, opt(s.kids), ST.num).set("F" + r, opt(s.senior), ST.num)
        .set("G" + r, s.hh ? +(s.pop / s.hh).toFixed(2) : 0, ST.dec2, `IF(C${r}=0,0,B${r}/C${r})`);
    });
    const c0 = 5 + areaRows.length + 1;
    area.set("A" + c0, "周辺のコインランドリー（候補地から近い順）", ST.h2);
    ["番号", "店名", "距離", "範囲", "住所"].forEach((h, i) => area.set(colName(i) + (c0 + 1), h, ST.head));
    area.merges.push(`E${c0 + 1}:G${c0 + 1}`);
    const comps = (d.comps || []).slice(0, 40);
    comps.forEach((c, i) => {
      const r = c0 + 2 + i;
      area.set("A" + r, i + 1, ST.num).set("B" + r, c.name, ST.label).set("C" + r, +c.km.toFixed(2), ST.km).set("D" + r, c.ring, ST.n).set("E" + r, c.address || "", ST.n);
      area.merges.push(`E${r}:G${r}`);
    });
    const rEnd = c0 + 2 + Math.max(1, comps.length) + 1;
    if (!comps.length) area.set("B" + (c0 + 2), d.comps ? "見つかりませんでした" : "（ここに周辺の競合店を記入）", d.comps ? ST.n : ST.inText);
    area.set("A" + rEnd, "出典: 総務省統計局「令和2年国勢調査 地域メッシュ統計（500mメッシュ）」を商圏の円で按分。" + (d.compSrc ? `他社店舗: ${d.compSrc}（登録されていない店もあります）。` : ""), ST.note);
    area.merges.push(`A${rEnd}:G${rEnd}`); area.heights[rEnd] = 36;

    // ---- 来店客数（来店率×来店頻度で推計する場合）
    let fc = null, dayRef;
    if (visit) {
      const vs = fc = new Sheet("来店客数").width("A", 24).width("B", 16).width("C", 12).width("D", 16).width("E", 16).width("F", 20);
      vs.set("A1", "来店客数の推計", ST.title);
      vs.set("A2", "月間来店客数 ＝ 商圏内の対象数（世帯または人口）× 来店率 × 来店頻度", ST.note);
      ["商圏", "対象数", "来店率", "来店客（人）", "来店頻度（回/月）", "月間来店客数（延べ）"].forEach((h, i) => vs.set(colName(i) + "4", h, ST.head));
      const byPop = d.visit.base === "人口", base = p("推計の対象（世帯 / 人口）");
      d.visit.rings.forEach((g, k) => {
        const r = 5 + k, ar = 5 + g.row, a = areaRows[g.row], tgt = byPop ? a.pop : a.hh;
        vs.set("A" + r, g.label, ST.label)
          .set("B" + r, Math.round(tgt), ST.num, `IF(${base}="人口",商圏分析!B${ar},商圏分析!C${ar})`)
          .set("C" + r, g.rate, ST.pct, `前提条件!$B$${rateRows[k]}`)
          .set("D" + r, Math.round(tgt * g.rate), ST.num, `B${r}*C${r}`)
          .set("E" + r, g.freq, ST.dec2, `前提条件!$C$${rateRows[k]}`)
          .set("F" + r, Math.round(tgt * g.rate * g.freq), ST.num, `D${r}*E${r}`);
      });
      const t = 5 + d.visit.rings.length;
      vs.set("A" + t, "合計", ST.label).set("F" + t, Math.round(visitTot), ST.bNum, `SUM(F5:F${t - 1})`);
      const days = pv("月間営業日数"), price = pv("客単価");
      [["1日平均来店客数", visitTot / days, `F${t}/${p("月間営業日数")}`, ST.bNum],
       ["年間来店客数（延べ）", visitTot * 12, `F${t}*12`, ST.num],
       ["月間売上見込み（3年目）", visitTot * price, `F${t}*${p("客単価")}`, ST.bYen],
       ["年間売上見込み（3年目）", visitTot * 12 * price, `F${t}*12*${p("客単価")}`, ST.yen]].forEach(([l, v, f, s], i) => {
        vs.set("A" + (t + 2 + i), l, ST.label).set("B" + (t + 2 + i), Math.round(v), s, f);
      });
      dayRef = `来店客数!B${t + 2}`;
    }
    // ---- 売上予測（オープンナビの判定）
    if (!visit) {
    fc = new Sheet("売上予測").width("A", 40).width("B", 22).width("C", 46);
    fc.set("A1", "売上予測（ランドリーオープンナビ）", ST.title);
    fc.set("A2", "ランドリープレスの売上実績をもとに算出（軌道に乗った3年目の目安）", ST.note);
    fc.set("A4", "判定", ST.label).set("B4", `${d.est.mark} ${d.est.markText}`, ST.b);
    fc.set("A5", "月の売上の見込み（3年目）", ST.label).set("B5", d.est.bandText, ST.b);
    fc.set("A6", "商圏だけで見た基準", ST.label).set("B6", d.est.baseText);
    fc.set("A7", "お店の条件の合計点", ST.label).set("B7", d.est.ptText);
    fc.set("A8", "計画に使う月の売上", ST.label).set("B8", pv("月の売上（軌道に乗った3年目）"), ST.yen, p("月の売上（軌道に乗った3年目）").replace(/\$/g, ""));
    fc.set("C8", A.salesNote, ST.note);
    fc.set("A9", "1日平均の来店客数（3年目）", ST.label).set("B9", Math.round(dayCust3), ST.num, `${p("月の売上（軌道に乗った3年目）")}/${p("客単価")}/${p("月間営業日数")}`);
    fc.set("C9", "月の売上 ÷ 客単価 ÷ 営業日数", ST.note);
    fc.set("A11", "商圏の判定", ST.h2);
    ["項目", "値", "判定"].forEach((h, i) => fc.set(colName(i) + "12", h, ST.head));
    d.est.cond.forEach((c, i) => { const r = 13 + i; fc.set("A" + r, c.label, ST.label).set("B" + r, c.value, ST.n).set("C" + r, c.note, ST.wrap); });
    let r = 13 + d.est.cond.length + 1;
    fc.set("A" + r, "お店の条件（直営店の標準的なつくりを0点として）", ST.h2); r++;
    ["項目", "選んだもの", "点数"].forEach((h, i) => fc.set(colName(i) + r, h, ST.head)); r++;
    d.spec.forEach((x) => { fc.set("A" + r, x.label, ST.label).set("B" + r, x.choice, ST.n).set("C" + r, x.pt, ST.n); r++; });
    if (d.checks && d.checks.length) {
      r++; fc.set("A" + r, "参考チェック（点数には入れていない）", ST.h2); r++;
      ["項目", "チェック", ""].forEach((h, i) => fc.set(colName(i) + r, h, ST.head)); r++;
      d.checks.forEach((x) => { fc.set("A" + r, x.label, ST.wrap).set("B" + r, x.choice, ST.n); r++; });
    }
    fc.set("A" + (r + 1), "※お店の条件は合計4点ごとに、売上の見込み（20万円きざみ）を1段階上げ下げしています。予測はあくまで目安で、実際の売上を約束するものではありません。", ST.note);
    fc.merges.push(`A${r + 1}:C${r + 1}`); fc.heights[r + 1] = 36;
    dayRef = "売上予測!B9";
    }

    // ---- 収支計画（3か年）
    const pl = new Sheet("収支計画").width("A", 46).width("B", 18).width("C", 18).width("D", 18);
    pl.set("A1", "収支計画（3か年）", ST.title);
    ["項目", "1年目", "2年目", "3年目"].forEach((h, i) => pl.set(colName(i) + "3", h, ST.head));
    const L = (k) => p(k);
    const rows = [
      ["売上高", (c, y) => `${L("月の売上（軌道に乗った3年目）")}*12*${L(ramps[y])}`, (y) => Y[y].sales, ST.bYen],
      ["年間来店客数（延べ）", (c) => `${c}4/${L("客単価")}`, (y) => Math.round(Y[y].cust), ST.num],
      ["変動費（水道光熱費・洗剤など）", (c) => `${c}4*${L("変動費率（水道光熱費・洗剤など）")}`, (y) => Y[y].vc, ST.yen],
      ["売上総利益", (c) => `${c}4-${c}6`, (y) => Y[y].gross, ST.yen],
      ["清掃・管理の委託費", () => `${L("清掃・管理の委託費（月）")}*12`, (y) => Y[y].fx[0], ST.yen],
      ["地代・家賃", () => `${L("地代・家賃（月）")}*12`, (y) => Y[y].fx[1], ST.yen],
      ["その他固定費", () => `${L("その他固定費（保守・保険・通信・広告）（月）")}*12`, (y) => Y[y].fx[2], ST.yen],
      ["減価償却費", () => `IF(${L("減価償却年数")}=0,0,${L("初期投資額")}/${L("減価償却年数")})`, (y) => Y[y].fx[3], ST.yen],
      ["営業利益", (c) => `${c}7-SUM(${c}8:${c}11)`, (y) => Y[y].op, ST.bYen],
      ["支払利息", (c, y) => `MAX(0,${L("借入金")}-IF(${L("返済期間（年）")}=0,0,${L("借入金")}/${L("返済期間（年）")})*${y})*${L("借入金利（年）")}`, (y) => Y[y].interest, ST.yen],
      ["経常利益", (c) => `${c}12-${c}13`, (y) => Y[y].ord, ST.bYen],
      ["借入金返済額", () => `IF(${L("返済期間（年）")}=0,0,${L("借入金")}/${L("返済期間（年）")})`, (y) => Y[y].repay, ST.yen],
      ["返済後キャッシュフロー（経常利益＋減価償却−返済）", (c) => `${c}14+${c}11-${c}15`, (y) => Y[y].cf, ST.yen],
    ];
    rows.forEach(([label, f, v, s], i) => {
      const rr = 4 + i;
      pl.set("A" + rr, label, [ST.bYen].includes(s) ? ST.label : ST.label);
      ["B", "C", "D"].forEach((c, y) => pl.set(c + rr, Math.round(v(y)), s, f(c, y)));
    });
    pl.set("A18", "損益分岐点の売上高（年）", ST.label).set("B18", Math.round(bep), ST.bYen, `IF(1-${L("変動費率（水道光熱費・洗剤など）")}<=0,0,SUM(B8:B11)/(1-${L("変動費率（水道光熱費・洗剤など）")}))`);
    pl.set("A19", "損益分岐点の月の売上", ST.label).set("B19", Math.round(bep / 12), ST.bYen, "B18/12");
    pl.set("A20", "損益分岐点の1日来店客数", ST.label).set("B20", Math.round(bepDay), ST.bNum, `B18/${L("客単価")}/(${L("月間営業日数")}*12)`);

    // ---- 事業計画書（1枚目）
    const sm = new Sheet("事業計画書").width("A", 26).width("B", 72);
    sm.grid = false;
    let i = 1;
    const line = (label, v, s = ST.wrap, f = null, ls = ST.label) => { if (label != null) sm.set("A" + i, label, ls); if (v != null || f) sm.set("B" + i, v, s, f); i++; };
    const gap = () => { i++; };
    const T = (ref, f = "#,##0") => `TEXT(${ref},"${f}")`;
    sm.set("A" + i, "事業計画書", ST.title); i++;
    line("作成日", d.created, ST.n);
    line("作成", "ランドリーオープンナビ（ランドリープレス）", ST.n);
    gap();
    sm.set("A" + i, "1. 事業概要", ST.h2); i++;
    line("店舗名", pv("店舗名"), ST.n, p("店舗名"));
    line("業種", pv("業種"), ST.n, p("業種"));
    line("所在地", d.address, ST.n, p("所在地"));
    line("開業予定日", pv("開業予定日"), ST.n, p("開業予定日"));
    line("事業内容", d.business || "セルフサービス式のコインランドリー（洗濯乾燥機・乾燥機・布団が洗える大型洗濯機）。年中無休で営業し、清掃・管理は委託する。", ST.inWrap);
    line("ターゲット顧客", d.target || "（ここに主な顧客層を記入）", ST.inWrap);
    gap();
    sm.set("A" + i, "2. 立地・商圏分析", ST.h2); i++;
    const jp = (v) => Math.round(v).toLocaleString("ja-JP");
    areaRows.filter((s) => s.sum).forEach((s) => line(s.label, `人口 ${jp(s.pop)}人 / 世帯数 ${jp(s.hh)}世帯` + (s.single != null ? `（単身世帯 ${jp(s.single)}世帯）` : "")));
    line("商圏の考察", d.areaText);
    line("競合状況", d.compText || "（ここに周辺の競合店の数・特徴を記入）", ST.inWrap);
    line("出典", "総務省統計局 令和2年国勢調査 地域メッシュ統計（500mメッシュ）を商圏の円で按分集計");
    gap();
    sm.set("A" + i, "3. 売上見込み", ST.h2); i++;
    if (visit) {
      line("推計方法", `商圏内の${d.visit.base}数に、距離帯ごとの来店率と月間来店頻度を掛けて推計した。`, ST.wrap, `"商圏内の"&${p("推計の対象（世帯 / 人口）")}&"数に、距離帯ごとの来店率と月間来店頻度を掛けて推計した。"`);
    } else {
      line("売上予測（3年目）", `${d.est.mark} ${d.est.bandText}（${d.est.markText}）`);
      line("予測の根拠", `ランドリープレスの売上実績をもとに算出。${d.est.baseText.replace(/^/, "商圏だけで見た基準 ")}、お店の条件 ${d.est.ptText}。`);
    }
    line(visit ? "月の売上（3年目）" : "計画に使う月の売上", pv("月の売上（軌道に乗った3年目）"), ST.yen, p("月の売上（軌道に乗った3年目）"));
    line("1日平均の来店客数", Math.round(dayCust3), ST.num, `${p("月の売上（軌道に乗った3年目）")}/${p("客単価")}/${p("月間営業日数")}`);
    line("客単価", pv("客単価"), ST.yen, p("客単価"));
    line("立ち上がり", `1年目は3年目の${Math.round(pv(ramps[0]) * 100)}%、2年目は${Math.round(pv(ramps[1]) * 100)}%` + (A.ramp ? "" : "（直営店の売上の伸び方より）"));
    gap();
    sm.set("A" + i, "4. 収支計画", ST.h2); i++;
    for (const [label, rr, key] of [["売上高", 4, "sales"], ["営業利益", 12, "op"], ["経常利益", 14, "ord"]]) {
      const txt = `1年目 ${yen(Y[0][key])} / 2年目 ${yen(Y[1][key])} / 3年目 ${yen(Y[2][key])}`;
      line(label, txt, ST.wrap, `"1年目 "&${T(`収支計画!B${rr}`)}&"円 / 2年目 "&${T(`収支計画!C${rr}`)}&"円 / 3年目 "&${T(`収支計画!D${rr}`)}&"円"`);
    }
    line("損益分岐点", `年間売上 ${yen(bep)}（月 ${man(bep / 12)}、1日あたり約${Math.round(bepDay)}人の来店）`, ST.wrap,
      `"年間売上 "&${T("収支計画!B18")}&"円（月 "&${T("収支計画!B19/10000")}&"万円、1日あたり約"&${T("収支計画!B20")}&"人の来店）"`);
    const ok = dayCust3 >= bepDay;
    line("採算性の判断", ok
      ? `3年目の1日来店客数（約${Math.round(dayCust3)}人）は損益分岐点（約${Math.round(bepDay)}人）を上回っており、採算が見込める。`
      : `3年目の1日来店客数（約${Math.round(dayCust3)}人）は損益分岐点（約${Math.round(bepDay)}人）を下回るため、家賃・初期投資・集客策の見直しが必要。`, ST.wrap,
      `IF(${dayRef}>=収支計画!B20,"3年目の1日来店客数（約"&${T(dayRef)}&"人）は損益分岐点（約"&${T("収支計画!B20")}&"人）を上回っており、採算が見込める。","3年目の1日来店客数（約"&${T(dayRef)}&"人）は損益分岐点（約"&${T("収支計画!B20")}&"人）を下回るため、家賃・初期投資・集客策の見直しが必要。")`);
    gap();
    sm.set("A" + i, "5. 資金計画", ST.h2); i++;
    line("初期投資額", pv("初期投資額"), ST.yen, p("初期投資額"));
    line("自己資金", pv("自己資金"), ST.yen, p("自己資金"));
    line("借入金", pv("借入金"), ST.yen, p("借入金"));
    line("資金の過不足", pv("自己資金") + pv("借入金") - pv("初期投資額"), ST.yen, `${p("自己資金")}+${p("借入金")}-${p("初期投資額")}`);
    gap();
    sm.set("A" + i, "6. 強み・集客策・リスク", ST.h2); i++;
    line("強み", d.strengths || "（ここに記入）", ST.inWrap);
    line("集客策", "オープン時のチラシ・のぼり、Googleマップへの登録と写真の掲載、LINE公式アカウントでのお得情報の配信、布団・毛布など季節の大物洗いの訴求。", ST.inWrap);
    line("リスクと対策", d.risks || "（ここに記入）", ST.inWrap);
    gap();
    sm.set("A" + i, "※黄色の欄は自由に書き換えてください。数字は「前提条件」シートを変えると計算し直されます。", ST.note); sm.merges.push(`A${i}:B${i}`); sm.heights[i] = 30;

    return [sm, pre, area, fc, pl];
  }

  async function makePlan(d, type = "blob") {
    if (!JSZipLib()) throw new Error("jszip");
    return toBlob(build(d), type);
  }
  const api = { makePlan, build };
  root.OpenNaviPlan = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
