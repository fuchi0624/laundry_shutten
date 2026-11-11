// 出店計画書（Excel）。Yutaさんの「出店計画書」（表紙＋10ページ）と同じ並び・同じ計算で作る（2026-11-11）。
// 売上はランドリーオープンナビの売上予測、費用・借入・10年の伸び方は出店計画書の前提。
// 黄色のセルを変えると、全部のシートが計算し直される（数式つき・開いた瞬間から数字が見えるよう計算済みの値も入れる）。
(function (root) {
  "use strict";
  const PL = () => root.OpenNaviPlan || (typeof require === "function" ? require("./plan.js") : null);

  // ------------------------------------------------------------ 初期値（出店計画書の初期値）
  // 機械設備: 定価は円（税抜）。料金は1回の料金、回は1ドラムあたり1日の回転数の目安
  const EQUIP = [
    ["洗濯機", "HCW-5108C", "10kg", 1, 565000, 0.9, 500, 1, 1],
    ["洗濯機", "WN132CS", "13kg", 0, 1580000, 0.8, 500, 1, 1],
    ["洗濯機", "WN232CS", "23kg", 0, 2000000, 0.8, 700, 1, 1],
    ["洗濯機", "WN282CS", "28kg", 0, 2310000, 0.8, 900, 1, 1],
    ["乾燥機", "VG143CW", "14kg×2", 4, 1530000, 0.8, 400, 5, 2],
    ["乾燥機", "VG253C", "25kg", 1, 1160000, 0.8, 500, 2, 1],
    ["洗濯乾燥機", "WD120CAT", "12kg", 0, 1990000, 0.8, 1200, 3, 1],
    ["洗濯乾燥機", "WD172CAT", "17kg", 1, 2290000, 0.8, 1400, 3, 1],
    ["洗濯乾燥機", "WD272CAT", "27kg", 2, 3030000, 0.8, 1600, 3, 1],
    ["洗濯乾燥機", "WD352CAT", "35kg", 1, 3620000, 0.8, 1800, 2, 1],
    ["スニーカー", "スニーカーランドリー", "", 1, 424000, 0.9, 400, 1, 1],
  ];
  // 付帯工事・備品: [項目, 数量(数字) または 自動("wd"=洗濯乾燥機の台数,"dr"=乾燥機の台数,"mb"=洗濯機＋洗濯乾燥機), 単価(円)]
  const OTHER = [
    ["両替機（ネット返金対応）", 1, 550000], ["タンク付き加圧ポンプ", 1, 880000], ["運賃梱包費", 1, 250000], ["搬入据付工事", 1, 350000],
    ["給排水工事", 1, 750000], ["ダクト工事（消音仕様）", 1, 750000], ["売上管理システム", 1, 1500000], ["ランドリープレス仕様（洗濯乾燥機）", "wd", 520000],
    ["スマートランドリー・洗剤投入機取付", 1, 400000], ["ランドリープレス仕様（乾燥機）", "dr", 70000], ["ガス工事（給湯器含む）", 1, 800000],
    ["アクア製品売上管理用基板", 2, 50000], ["備品類", 1, 650000], ["防犯カメラシステム・店内モニター他（4CH）", 1, 450000],
    ["マイクロバブルキット", "mb", 30000], ["試運転・現場諸経費・現場管理費", 1, 550000],
  ];
  const DEF = { elec: 2500000, interior: 6000000, disc: 0, rent: 250000, fixed: 36000, c_el: 0.10, c_gas: 0.09, c_wat: 0.05, c_det: 0.03,
    loan_r: 0.03, loan_y: 10, loan_y2: 10, dz: [0, 0.05, 0.10, 0.15, 0.20], comp_y: 5, area: 85.8, park: 5, fmt: "路面店（単独の建物）" };
  const RAMP = [0.80, 0.92, 1.00, 1.09, 1.11, 1.11, 1.11, 1.11, 1.11, 1.11];
  const SEASON = [0.94, 0.84, 0.97, 1.02, 1.08, 1.09, 1.02, 0.90, 0.83, 1.09, 1.06, 1.18];

  // ------------------------------------------------------------ 見た目（スタイル）
  const NUMFMT = { yen: 164, pct1: 165, km: 166, dec1: 167, int: 168, man: 169, pct0: 170, int0: 3, dec2: 2 };
  const FONTS = [
    '<sz val="10.5"/>', '<b/><sz val="10.5"/>', '<b/><sz val="22"/><color rgb="FF26201B"/>', '<b/><sz val="13"/><color rgb="FF26201B"/>',
    '<sz val="9"/><color rgb="FF8F847B"/>', '<b/><sz val="10.5"/><color rgb="FFFFFFFF"/>', '<b/><sz val="20"/><color rgb="FFED6C00"/>',
    '<b/><sz val="30"/><color rgb="FF26201B"/>', '<b/><sz val="10.5"/><color rgb="FFC25700"/>', '<b/><sz val="9"/><color rgb="FFED6C00"/>',
    '<b/><sz val="14"/><color rgb="FF26201B"/>', '<b/><sz val="12"/><color rgb="FFFFFFFF"/>',
  ];
  const FILLS = ["FFFFF2CC", "FF26201B", "FFFAF6F2", "FFED6C00", "FFFDEEDF"]; // 2..6
  const FILL = { in: 2, dark: 3, tint: 4, brand: 5, soft: 6 };
  // [名前, 数値の形, 文字, 塗り, 罫線(0なし/1細/2下オレンジ), 配置]
  const XF = [
    ["n", 0, 0, 0, 0], ["b", 0, 1, 0, 0], ["hdr", 0, 4, 0, 0], ["title", 0, 2, 0, 0], ["h2", 0, 3, 0, 2], ["note", 0, 4, 0, 0, "wrap"], ["head", 0, 5, FILL.dark, 1, "center"],
    ["headL", 0, 5, FILL.dark, 1, "wrap"], ["label", 0, 0, FILL.tint, 1, "wrap"], ["labelB", 0, 1, FILL.tint, 1, "wrap"], ["cell", 0, 0, 0, 1, "wrap"], ["cellB", 0, 1, 0, 1, "wrap"],
    ["yen", NUMFMT.yen, 0, 0, 1], ["yenB", NUMFMT.yen, 1, 0, 1], ["int", NUMFMT.int, 0, 0, 1], ["intB", NUMFMT.int, 1, FILL.tint, 1], ["pct", NUMFMT.pct1, 0, 0, 1], ["pct0", NUMFMT.pct0, 0, 0, 1],
    ["dec1", NUMFMT.dec1, 0, 0, 1], ["dec2", NUMFMT.dec2, 0, 0, 1], ["km", NUMFMT.km, 0, 0, 1],
    ["inText", 0, 0, FILL.in, 1, "wrap"], ["inYen", NUMFMT.yen, 0, FILL.in, 1], ["inInt", NUMFMT.int0, 0, FILL.in, 1], ["inPct", NUMFMT.pct1, 0, FILL.in, 1],
    ["inDec", NUMFMT.dec1, 0, FILL.in, 1], ["inDec2", NUMFMT.dec2, 0, FILL.in, 1],
    ["kpiL", 0, 4, FILL.soft, 0, "wrapTop"], ["kpiV", NUMFMT.man, 6, FILL.soft, 0, "left"], ["kpiT", 0, 6, FILL.soft, 0, "left"], ["kpiS", 0, 4, FILL.soft, 0, "wrap"],
    ["cover", 0, 7, 0, 0], ["coverS", 0, 10, 0, 0], ["eyebrow", 0, 9, 0, 0], ["secNo", 0, 6, 0, 0], ["band", 0, 11, FILL.brand, 0, "left"],
    ["man", NUMFMT.man, 0, 0, 1], ["manB", NUMFMT.man, 1, FILL.tint, 1], ["manBig", NUMFMT.man, 6, 0, 0, "left"], ["sumRow", NUMFMT.int, 8, FILL.soft, 1], ["sumLabel", 0, 8, FILL.soft, 1],
    ["judgeOk", 0, 5, FILL.brand, 1, "wrap"], ["textBig", 0, 10, 0, 0, "wrap"],
  ];
  const ST = Object.fromEntries(XF.map((x, i) => [x[0], i]));
  const ALIGN = { wrap: '<alignment wrapText="1" vertical="top"/>', wrapTop: '<alignment wrapText="1" vertical="bottom"/>', center: '<alignment horizontal="center" vertical="center" wrapText="1"/>', left: '<alignment horizontal="left" vertical="center"/>' };
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="7"><numFmt numFmtId="164" formatCode="#,##0&quot;円&quot;;[Red]\\-#,##0&quot;円&quot;"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="0.0&quot;km&quot;"/><numFmt numFmtId="167" formatCode="0.0"/><numFmt numFmtId="168" formatCode="#,##0;[Red]\\-#,##0"/><numFmt numFmtId="169" formatCode="#,##0&quot;万円&quot;;[Red]\\-#,##0&quot;万円&quot;"/><numFmt numFmtId="170" formatCode="0%"/></numFmts>
<fonts count="${FONTS.length}">${FONTS.map((f) => `<font>${f}<name val="游ゴシック"/><family val="3"/><charset val="128"/></font>`).join("")}</fonts>
<fills count="${FILLS.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${FILLS.map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`).join("")}</fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFDDD3CA"/></left><right style="thin"><color rgb="FFDDD3CA"/></right><top style="thin"><color rgb="FFDDD3CA"/></top><bottom style="thin"><color rgb="FFDDD3CA"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FFED6C00"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${XF.length}">${XF.map(([, nf, fo, fi, bo, al]) => `<xf numFmtId="${nf}" fontId="${fo}" fillId="${fi}" borderId="${bo}" xfId="0"${nf ? ' applyNumberFormat="1"' : ""} applyFont="1"${fi ? ' applyFill="1"' : ""}${bo ? ' applyBorder="1"' : ""}${al ? ` applyAlignment="1">${ALIGN[al]}</xf>` : "/>"}`).join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const man = (v) => Math.round(v / 1e4).toLocaleString("ja-JP");
  const pmt = (P, ir, n) => (n <= 0 ? 0 : ir > 0 ? (P * ir) / (1 - Math.pow(1 + ir, -n)) : P / n);
  const TX = (ref, f = "#,##0") => `TEXT(${ref},"${f}")`;

  // ------------------------------------------------------------ 中身
  function build(d) {
    const { Sheet, colName } = PL();
    const A = d.inputs, K = d.keikaku || {};
    const toList = (x) => (Array.isArray(x) ? x : String(x || "").split("。").map((t) => t.trim()).filter(Boolean));
    d = { ...d, strengths: toList(d.strengths), risks: toList(d.risks) };
    const sheets = [];
    const mk = (name, widths, land = true) => {
      const s = new Sheet(name); s.grid = false; s.landscape = land;
      Object.entries(widths).forEach(([c, w]) => s.width(c, w)); sheets.push(s); return s;
    };
    // ページの見出し（出店計画書と同じ「番号・英語・日本語・説明」）
    const head = (s, no, en, jp, sub, last = "H") => {
      s.set("A1", `出店計画書｜${A.name}`, ST.hdr).set(last + "1", "Laundry Press", ST.hdr); s.fitH = 1;
      s.set("A2", String(no).padStart(2, "0"), ST.secNo).set("B2", en, ST.eyebrow);
      s.set("B3", jp, ST.title); if (sub) s.set("B4", sub, ST.hdr);
      s.heights[2] = 26; s.heights[3] = 34;
    };

    // ===== 前提条件（入力欄） =====
    const pre = new Sheet("前提条件"); pre.width("A", 40).width("B", 20).width("C", 52); pre.tab("FFFFC000");
    pre.set("A1", "前提条件（黄色の欄を変えると、全部のシートが計算し直されます）", ST.h2);
    const P = {}; let r = 3;
    const inp = (key, label, v, s, note) => { pre.set("A" + r, label, ST.label).set("B" + r, v, s); if (note) pre.set("C" + r, note, ST.note); P[key] = { ref: `前提条件!$B$${r}`, v, r }; r++; };
    const calc = (key, label, v, s, f, note) => { pre.set("A" + r, label, ST.labelB).set("B" + r, v, s, f); if (note) pre.set("C" + r, note, ST.note); P[key] = { ref: `前提条件!$B$${r}`, v, r }; r++; };
    const sec = (t) => { r++; pre.set("A" + r, t, ST.h2); r++; };
    sec("候補地");
    inp("name", "店舗名（仮称）", A.name, ST.inText);
    inp("client", "客先名（表紙に入ります）", K.client || "", ST.inText, "空欄なら表紙に出ません");
    inp("addr", "所在地", d.address, ST.inText);
    inp("open", "開業予定", A.open || "（未定）", ST.inText);
    inp("fmt", "出店形態", K.fmt || DEF.fmt, ST.inText, "路面店（単独の建物）／商業施設の敷地内の独立店舗／商業施設のテナント");
    inp("area", "店舗面積（㎡）", K.area || DEF.area, ST.inDec);
    calc("tsubo", "店舗面積（坪）", (K.area || DEF.area) / 3.3058, ST.dec1, `${"B" + (r - 1)}/3.3058`);
    inp("park", "駐車場（台）", K.park != null ? K.park : DEF.park, ST.inInt);
    sec("売上");
    inp("sales", "月の売上（3年目・円）", A.sales, ST.inYen, A.salesNote || "ランドリーオープンナビの売上予測");
    inp("price", "客単価（1回・円）", A.price, ST.inYen, "1日の利用回数の目安に使います");
    sec("費用");
    inp("rent", "家賃（月・円）", A.rent != null ? A.rent : DEF.rent, ST.inYen);
    inp("fixed", "スマートランドリー・コールセンター他（月・円）", DEF.fixed, ST.inYen);
    inp("c_el", "電気代（売上に対する割合）", DEF.c_el, ST.inPct);
    inp("c_gas", "ガス代（売上に対する割合）", DEF.c_gas, ST.inPct);
    inp("c_wat", "水道代（売上に対する割合）", DEF.c_wat, ST.inPct);
    inp("c_det", "洗剤・柔軟剤（売上に対する割合）", DEF.c_det, ST.inPct);
    const runPct = DEF.c_el + DEF.c_gas + DEF.c_wat + DEF.c_det;
    calc("run", "ランニングコスト（合計）", runPct, ST.pct, `SUM(B${r - 4}:B${r - 1})`);
    sec("借入");
    inp("loan_r", "借入金利（年）", DEF.loan_r, ST.inPct, "初期投資（税込）の全額を借り入れると仮定");
    inp("loan_y", "返済年数（機械・工事）", DEF.loan_y, ST.inInt);
    inp("loan_y2", "返済年数（内装・電気）", DEF.loan_y2, ST.inInt);
    sec("競合が近くに出店したとき");
    inp("comp_y", "競合が近くに出店すると想定する年", DEF.comp_y, ST.inInt);
    const dzL = ["40坪以上", "30〜40坪", "25〜30坪", "20〜25坪", "20坪未満"], dzR = [];
    dzL.forEach((l, i) => { inp("dz" + i, `売上の減少率（店の広さ ${l}）`, DEF.dz[i], ST.inPct); dzR.push(P["dz" + i].ref); });
    const ts = P.tsubo.v, dzV = DEF.dz[ts >= 40 ? 0 : ts >= 30 ? 1 : ts >= 25 ? 2 : ts >= 20 ? 3 : 4];
    const T = P.tsubo.ref;
    calc("dz", "この店の減少率", dzV, ST.pct, `IF(${T}>=40,${dzR[0]},IF(${T}>=30,${dzR[1]},IF(${T}>=25,${dzR[2]},IF(${T}>=20,${dzR[3]},${dzR[4]}))))`, "店が広いほど、後から競合が来ても負けにくい");
    const defLv = dzV <= 0.05 ? "高" : dzV <= 0.10 ? "中" : "低";
    calc("defLv", "競合への強さ", defLv, ST.cellB, `IF(${P.dz.ref}<=0.05,"高",IF(${P.dz.ref}<=0.1,"中","低"))`);
    sec("売上の伸び方（3年目を100%として）");
    const rampRow = r; pre.set("A" + r, "年", ST.head); RAMP.forEach((_, i) => pre.set(colName(i + 1) + r, `${i + 1}年目`, ST.head)); r++;
    pre.set("A" + r, "売上の割合", ST.label); RAMP.forEach((v, i) => pre.set(colName(i + 1) + r, v, ST.inPct)); const rampR = r; r++;
    pre.set("A" + r, "当社直営店の平均的な立ち上がり", ST.note); r++;
    sec("月ごとの売上の波（年平均を100%として）");
    pre.set("A" + r, "月", ST.head); SEASON.forEach((_, i) => pre.set(colName(i + 1) + r, `${i + 1}月`, ST.head)); r++;
    pre.set("A" + r, "売上の割合", ST.label); SEASON.forEach((v, i) => pre.set(colName(i + 1) + r, v, ST.inPct)); const seasR = r; r++;
    pre.set("A" + r, "当社直営店の2018〜2026年の実績から", ST.note); r++;
    pre.cols = []; pre.width("A", 40).width("B", 20).width("C", 14);
    for (let c = 3; c <= 12; c++) pre.width(colName(c), 9);
    // C列の注記は幅が狭くなるので、注記は D 列まで結合して見せる
    for (const k of Object.keys(P)) { const rr = P[k].r; if (pre.rows.get(rr) && pre.rows.get(rr).has("C")) pre.merges.push(`C${rr}:H${rr}`); }
    const rampRef = (i) => `前提条件!$${colName(i + 1)}$${rampR}`, seasRef = (i) => `前提条件!$${colName(i + 1)}$${seasR}`;
    const p = (k) => P[k].ref, v = (k) => P[k].v;

    // ===== 初期投資（機械・工事の表もここで入力） =====
    const inv = mk("初期投資", { A: 14, B: 30, C: 12, D: 14, E: 9, F: 14, G: 8, H: 16 });
    head(inv, 7, "INVESTMENT", "初期投資", "開業に必要な費用の全体像と、その内訳（黄色の欄は変えられます）");
    let ir = 6;
    inv.set("A" + ir, "機械設備（税抜・円）", ST.h2); ir++;
    ["種類", "機種", "容量", "定価", "掛率", "単価", "台数", "金額"].forEach((h, i) => inv.set(colName(i) + ir, h, ST.head)); ir++;
    const mStart = ir;
    const E = (K.equip || EQUIP).map((e) => ({ kind: e[0], model: e[1], cap: e[2], n: e[3], list: e[4], rate: e[5], price: e[6], turn: e[7], dr: e[8] }));
    E.forEach((e) => {
      e.unit = Math.round(e.list * e.rate); e.row = ir;
      inv.set("A" + ir, e.kind, ST.cell).set("B" + ir, e.model, ST.cell).set("C" + ir, e.cap, ST.cell)
        .set("D" + ir, e.list, ST.inYen).set("E" + ir, e.rate, ST.inPct).set("F" + ir, e.unit, ST.yen, `ROUND(D${ir}*E${ir},0)`)
        .set("G" + ir, e.n, ST.inInt).set("H" + ir, e.n * e.unit, ST.yen, `F${ir}*G${ir}`);
      ir++;
    });
    const mEnd = ir - 1;
    const machineInv = E.reduce((a, e) => a + e.n * e.unit, 0);
    inv.set("A" + ir, "機械設備 計", ST.labelB).set("H" + ir, machineInv, ST.yenB, `SUM(H${mStart}:H${mEnd})`); const mTot = `初期投資!$H$${ir}`; ir++;
    const cnt = (k) => E.filter((e) => e.kind === k).reduce((a, e) => a + e.n, 0);
    const cntF = (k) => `SUMIF(初期投資!$A$${mStart}:$A$${mEnd},"${k}",初期投資!$G$${mStart}:$G$${mEnd})`;
    const C = { wa: cnt("洗濯機"), dr: cnt("乾燥機"), wd: cnt("洗濯乾燥機"), sn: cnt("スニーカー"), pockets: E.filter((e) => e.kind === "乾燥機").reduce((a, e) => a + e.n * e.dr, 0) };
    const autoQ = { wd: [C.wd, cntF("洗濯乾燥機")], dr: [C.dr, cntF("乾燥機")], mb: [C.wa + C.wd, `${cntF("洗濯機")}+${cntF("洗濯乾燥機")}`] };
    ir++;
    inv.set("A" + ir, "付帯工事・備品（税抜・円）", ST.h2); ir++;
    ["項目", "", "", "単価", "", "", "数量", "金額"].forEach((h, i) => inv.set(colName(i) + ir, h, ST.head)); ir++;
    const oStart = ir; let otherInv = 0;
    (K.other || OTHER).forEach(([t, q, u]) => {
      const auto = typeof q === "string", qv = auto ? autoQ[q][0] : q;
      inv.set("A" + ir, t + (auto ? "（台数から自動）" : ""), ST.cell); inv.merges.push(`A${ir}:C${ir}`);
      inv.set("D" + ir, u, ST.inYen).set("G" + ir, qv, auto ? ST.int : ST.inInt, auto ? autoQ[q][1] : null).set("H" + ir, qv * u, ST.yen, `D${ir}*G${ir}`);
      otherInv += qv * u; ir++;
    });
    inv.set("A" + ir, "付帯工事・備品 計", ST.labelB).set("H" + ir, otherInv, ST.yenB, `SUM(H${oStart}:H${ir - 1})`); const oTot = `初期投資!$H$${ir}`; ir++;
    ir++;
    inv.set("A" + ir, "電気・内装工事・値引（税抜・円）", ST.h2); ir++;
    const ein = (label, val, key) => { inv.set("A" + ir, label, ST.label); inv.merges.push(`A${ir}:G${ir}`); inv.set("H" + ir, val, ST.inYen); P[key] = { ref: `初期投資!$H$${ir}`, v: val }; ir++; };
    ein("電気工事（動力・分電盤・照明配線）", K.elec != null ? K.elec : DEF.elec, "elec");
    ein("内装・看板工事", K.interior != null ? K.interior : DEF.interior, "interior");
    ein("出精値引（引く金額）", DEF.disc, "disc");
    ir++;
    const invEx = machineInv + otherInv + v("elec") + v("interior") - v("disc"), tax = Math.round(invEx * 0.1), invT = invEx + tax;
    const facil = machineInv + otherInv - v("disc"), bld = v("elec") + v("interior");
    const pay1 = pmt(facil * 1.1, v("loan_r") / 12, v("loan_y") * 12), pay2 = pmt(bld * 1.1, v("loan_r") / 12, v("loan_y2") * 12);
    inv.set("A" + ir, "合計", ST.h2); ir++;
    const tot = (label, val, f, key, s = ST.yenB) => { inv.set("A" + ir, label, ST.labelB); inv.merges.push(`A${ir}:G${ir}`); inv.set("H" + ir, Math.round(val), s, f); P[key] = { ref: `初期投資!$H$${ir}`, v: val }; ir++; };
    tot("初期投資（税抜）", invEx, `${mTot}+${oTot}+${p("elec")}+${p("interior")}-${p("disc")}`, "inv", ST.yen);
    tot("消費税（10%）", tax, `ROUND(${P.inv.ref}*0.1,0)`, "tax", ST.yen);
    tot("初期投資の総額（税込）", invT, `${P.inv.ref}+${P.tax.ref}`, "invT");
    tot("借入（機械・工事分・税込）", facil * 1.1, `(${mTot}+${oTot}-${p("disc")})*1.1`, "facil", ST.yen);
    tot("借入（内装・電気分・税込）", bld * 1.1, `(${p("elec")}+${p("interior")})*1.1`, "build", ST.yen);
    tot("月々の返済（機械・工事）", pay1, `IF(${p("loan_y")}<=0,0,PMT(${p("loan_r")}/12,${p("loan_y")}*12,-${P.facil.ref}))`, "pay1", ST.yen);
    tot("月々の返済（内装・電気）", pay2, `IF(${p("loan_y2")}<=0,0,PMT(${p("loan_r")}/12,${p("loan_y2")}*12,-${P.build.ref}))`, "pay2", ST.yen);
    ir++;
    inv.set("A" + ir, "物件の状態（既存の給排水・ガス・電気容量）により工事費は増減します。土地・建物の取得費、保証金、開業前の家賃は含みません。数量0の項目は今回の計画では不要なものです。", ST.note);
    inv.merges.push(`A${ir}:H${ir}`); inv.heights[ir] = 30;
    inv.landscape = false; inv.fitH = 1;

    // ===== 10年収支計画 =====
    const S10 = mk("10年収支計画", { A: 30, B: 10, C: 10, D: 10, E: 10, F: 10, G: 10, H: 10, I: 10, J: 10, K: 10 });
    head(S10, 9, "10-YEAR PLAN", "10年収支計画", "開業から10年間の収支（単位：万円）", "K");
    const sales = v("sales"), rent = v("rent"), fx = v("fixed"), y1 = v("loan_y"), y2 = v("loan_y2"), compY = v("comp_y");
    S10.set("A6", "", ST.head); RAMP.forEach((_, i) => S10.set(colName(i + 1) + "6", i === 0 ? "初年度" : `${i + 1}年目`, ST.head));
    S10.set("A5", "年（計算用）", ST.note); RAMP.forEach((_, i) => S10.set(colName(i + 1) + "5", i + 1, ST.note));
    let cum = 0, cum2 = 0, payback = null, payback2 = null;
    const Y = RAMP.map((rp, i) => {
      const rev = sales * 12 * rp / 1e4, cost = rev * runPct, rnt = rent * 12 / 1e4, l1 = i < y1 ? pay1 * 12 / 1e4 : 0, l2 = i < y2 ? pay2 * 12 / 1e4 : 0, f = fx * 12 / 1e4;
      const prof = rev - cost - rnt - l1 - l2 - f; cum += prof; if (payback === null && cum > 0) payback = i + 1;
      const k = i + 1 >= compY ? 1 - dzV : 1, rev2 = rev * k, prof2 = rev2 - rev2 * runPct - rnt - l1 - l2 - f; cum2 += prof2; if (payback2 === null && cum2 > 0) payback2 = i + 1;
      return { rp, rev, cost, rnt, l1, l2, f, prof, cum, cum2 };
    });
    const rows10 = [
      ["売上の割合", "rp", (c, i) => rampRef(i), ST.pct0],
      ["売上", "rev", (c, i) => `${p("sales")}*12*${c}7/10000`, ST.manB],
      ["ランニングコスト", "cost", (c) => `${c}8*${p("run")}`, ST.int],
      ["家賃", "rnt", () => `${p("rent")}*12/10000`, ST.int],
      ["返済（機械・工事）", "l1", (c) => `IF(${c}$5<=${p("loan_y")},${P.pay1.ref}*12/10000,0)`, ST.int],
      ["返済（内装・電気）", "l2", (c) => `IF(${c}$5<=${p("loan_y2")},${P.pay2.ref}*12/10000,0)`, ST.int],
      ["スマラン他", "f", () => `${p("fixed")}*12/10000`, ST.int],
      ["純利益（手残り）", "prof", (c) => `${c}8-SUM(${c}9:${c}13)`, ST.sumRow],
      ["純利益の累計", "cum", (c, i) => (i ? `${colName(i)}15+${c}14` : `${c}14`), ST.sumRow],
      [`累計（${compY}年目に近くへ競合出店）`, "cum2", (c, i) => `${i ? colName(i) + "16+" : ""}${c}8*IF(${c}$5>=${p("comp_y")},1-${p("dz")},1)*(1-${p("run")})-SUM(${c}9:${c}13)`, ST.int],
    ];
    rows10.forEach(([label, key, f, s], j) => {
      const rr = 7 + j;
      S10.set("A" + rr, label, [ST.sumRow].includes(s) ? ST.sumLabel : ST.label);
      Y.forEach((y, i) => { const c = colName(i + 1); S10.set(c + rr, key === "rp" ? y[key] : Math.round(y[key]), s, f(c, i)); });
    });
    const PB = (rng) => `IFERROR(MATCH(TRUE,INDEX(${rng}>0,0),0)&"年目","10年内は未達")`;
    S10.set("A19", "初期投資（税込）", ST.labelB).set("B19", Math.round(invT / 1e4), ST.manB, `${P.invT.ref}/10000`); S10.merges.push("B19:C19");
    S10.set("A20", "累計黒字化", ST.labelB).set("B20", payback ? payback + "年目" : "10年内は未達", ST.cellB, PB("$B$15:$K$15")); S10.merges.push("B20:C20");
    S10.set("A21", "10年間の累計手残り", ST.labelB).set("B21", Math.round(Y[9].cum), ST.manB, "K15"); S10.merges.push("B21:C21");
    S10.set("A22", `${compY}年目に競合が出店した場合の10年累計`, ST.labelB).set("B22", Math.round(Y[9].cum2), ST.manB, "K16"); S10.merges.push("B22:C22");
    S10.set("A24", "売上は初年度80%、2年目92%、3年目100%、4年目109%、5年目以降111%（当社直営店の平均的な立ち上がり。前提条件で変えられます）。借入は初期投資（税込）の全額を元利均等で返済すると仮定。洗剤・柔軟剤以外の消耗品、部品代、メンテナンス費、保険料、税金は含みません。", ST.note);
    S10.merges.push("A24:K24"); S10.heights[24] = 44;

    // ===== 月間収支と設備能力 =====
    const MO = mk("月間収支", { A: 40, B: 15, C: 15, D: 15, E: 4, F: 22, G: 12, H: 12, I: 12, J: 12 });
    head(MO, 8, "MONTHLY P&L", "月間収支と設備能力", "1か月の収支と、予測売上に対して機械が足りるか", "J");
    const cols = [["初年度", 0], ["3年目", 2], ["5年目以降", 4]];
    MO.set("A6", "月間収支（円／月）", ST.headL); cols.forEach(([t, i], j) => MO.set(colName(j + 1) + "6", `${t}（売上${Math.round(RAMP[i] * 100)}%）`, ST.head));
    const mrows = [
      ["売上", (m) => m, (c, i) => `${p("sales")}*${rampRef(i)}`, ST.yenB],
      ["電気代", (m) => -m * DEF.c_el, (c) => `-${c}7*${p("c_el")}`, ST.yen], ["ガス代", (m) => -m * DEF.c_gas, (c) => `-${c}7*${p("c_gas")}`, ST.yen],
      ["水道代", (m) => -m * DEF.c_wat, (c) => `-${c}7*${p("c_wat")}`, ST.yen], ["洗剤・柔軟剤", (m) => -m * DEF.c_det, (c) => `-${c}7*${p("c_det")}`, ST.yen],
      ["家賃", () => -rent, () => `-${p("rent")}`, ST.yen], ["スマートランドリー・コールセンター他", () => -fx, () => `-${p("fixed")}`, ST.yen],
      ["借入返済（機械・工事）", () => -pay1, () => `-${P.pay1.ref}`, ST.yen], ["借入返済（内装・電気）", () => -pay2, () => `-${P.pay2.ref}`, ST.yen],
    ];
    mrows.forEach(([label, fn, f, s], j) => { const rr = 7 + j; MO.set("A" + rr, label, ST.label); cols.forEach(([, i], k) => { const c = colName(k + 1); MO.set(c + rr, Math.round(fn(sales * RAMP[i])), s, f(c, i)); }); });
    const net = (m) => m * (1 - runPct) - rent - fx - pay1 - pay2;
    MO.set("A16", "月々の手残り", ST.sumLabel); cols.forEach(([, i], k) => { const c = colName(k + 1); MO.set(c + "16", Math.round(net(sales * RAMP[i])), ST.sumRow, `SUM(${c}7:${c}15)`); });
    MO.set("A17", "借入は初期投資（税込）の全額を、機械・工事分と内装・電気分に分けて元利均等で返済した場合。", ST.note); MO.merges.push("A17:D17");
    // 3年目の売上の使いみち
    const m3 = sales * RAMP[2];
    MO.set("A19", "3年目の売上の使いみち", ST.h2);
    [["ランニングコスト", m3 * runPct, `C7*${p("run")}`], ["家賃", rent, p("rent")], ["借入返済", pay1 + pay2, `${P.pay1.ref}+${P.pay2.ref}`], ["スマラン他", fx, p("fixed")], ["手残り", net(m3), "C16"]].forEach(([l, val, f], j) => {
      const rr = 20 + j; MO.set("A" + rr, l, ST.label).set("B" + rr, Math.round(val), ST.yen, f).set("C" + rr, m3 ? val / m3 : 0, ST.pct0, `IF($C$7=0,0,B${rr}/$C$7)`);
    });
    // 機械は足りるか
    const cap = E.reduce((a, e) => a + e.n * e.dr * e.price * e.turn * 30, 0), kk = cap ? sales / cap : 0;
    MO.set("F6", "機械は足りるか（3年目）", ST.headL); MO.merges.push("F6:J6");
    ["機種", "料金", "ドラム数", "標準の回/日", "必要な回/日"].forEach((h, i) => MO.set(colName(5 + i) + "7", h, ST.head));
    let cr = 8;
    E.forEach((e) => {
      const ref = (col) => `初期投資!$${col}$${e.row}`;
      MO.set("F" + cr, `${e.model} ${e.cap}`.trim(), ST.cell).set("G" + cr, e.price, ST.inYen).set("H" + cr, e.n * e.dr, ST.int, `${ref("G")}*${e.dr}`)
        .set("I" + cr, e.turn, ST.inDec).set("J" + cr, +(e.turn * kk).toFixed(1), ST.dec1, `I${cr}*$G$${8 + E.length + 1}`);
      e.mrow = cr; cr++;
    });
    MO.set("F" + cr, "機械をフルに回したときの月の売上", ST.label).set("G" + cr, Math.round(cap), ST.yen, `SUMPRODUCT(G8:G${cr - 1},H8:H${cr - 1},I8:I${cr - 1})*30`); MO.merges.push(`G${cr}:H${cr}`); cr++;
    MO.set("F" + cr, "予測売上に必要な回転（標準＝1.0）", ST.labelB).set("G" + cr, +kk.toFixed(2), ST.dec2, `IF(G${cr - 1}=0,0,${p("sales")}/G${cr - 1})`);
    const kRow = cr; cr++;
    const bal = kk > 1.15 ? "回転不足：予測売上を出すには標準より多く回す必要があります。台数の追加をおすすめします。" : kk < 0.85 ? "機械に余裕：標準の回転数で予測売上を十分まかなえます。繁忙期も待ち時間が少なく済みます。" : "バランス良好：予測売上と機械の能力がほぼ一致した、無駄のない構成です。";
    MO.set("F" + cr, bal, ST.cellB, `IF(G${kRow}>1.15,"回転不足：予測売上を出すには標準より多く回す必要があります。台数の追加をおすすめします。",IF(G${kRow}<0.85,"機械に余裕：標準の回転数で予測売上を十分まかなえます。繁忙期も待ち時間が少なく済みます。","バランス良好：予測売上と機械の能力がほぼ一致した、無駄のない構成です。"))`);
    MO.merges.push(`F${cr}:J${cr}`); MO.heights[cr] = 36; cr++;
    MO.set("F" + cr, "標準の回/日は当社直営店の稼働実績にもとづく1ドラムあたりの目安。料金・回/日は黄色の欄で変えられます。", ST.note); MO.merges.push(`F${cr}:J${cr}`); MO.heights[cr] = 30;
    // 必要な回/日の式は kRow を参照する
    E.forEach((e) => MO.set("J" + e.mrow, +(e.turn * kk).toFixed(1), ST.dec1, `I${e.mrow}*$G$${kRow}`));

    // ===== リスクと対策 =====
    const RI = mk("リスクと対策", { A: 34, B: 18, C: 16, D: 16, E: 4, F: 40 });
    head(RI, 10, "RISKS & MEASURES", "リスクと対策", "起こりうるリスクと、その影響の試算、当社の対策", "F");
    const ug = (DEF.c_el + DEF.c_gas) * 0.2;
    const SC = [["計画どおり", 1, 0, false], ["売上が10%下振れ", 0.9, 0, false], ["売上が20%下振れ", 0.8, 0, false], ["電気・ガス代が20%上昇", 1, ug, false], [`${compY}年目に近くへ競合出店`, 1, 0, true]];
    // 計算用の表（下のほう）: シナリオごとの累計
    const hr0 = 28;
    S10.set("A" + (hr0 - 1), "（参考）もしもの試算：純利益の累計", ST.h2);
    const scen = SC.map(([name, sm, cm, comp], j) => {
      const rr = hr0 + j; let c2 = 0, pb = null, m3p = 0;
      S10.set("A" + rr, name, ST.label);
      Y.forEach((y, i) => {
        const k = sm * (comp && i + 1 >= compY ? 1 - dzV : 1), rev = y.rev * k, prof = rev - rev * (runPct + cm) - y.rnt - y.l1 - y.l2 - y.f;
        c2 += prof; if (pb === null && c2 > 0) pb = i + 1; if (i === 2) m3p = prof / 12;
        const c = colName(i + 1), y10 = (row) => `'10年収支計画'!${c}${row}`;
        const kf = `${sm}${comp ? `*IF(${i + 1}>=${p("comp_y")},1-${p("dz")},1)` : ""}`;
        const cmF = cm ? `+(${p("c_el")}+${p("c_gas")})*0.2` : "";
        S10.set(c + rr, Math.round(c2), ST.int, `${i ? colName(i) + rr + "+" : ""}${y10(8)}*${kf}*(1-(${p("run")}${cmF}))-SUM(${y10(10)}:${y10(13)})`);
      });
      return { name, m3p, cum: c2, pb, rr };
    });
    RI.set("A6", "もしもの試算", ST.headL); ["3年目の月の手残り", "累計黒字化", "10年累計"].forEach((h, i) => RI.set(colName(i + 1) + "6", h, ST.head));
    scen.forEach((s, j) => {
      const rr = 7 + j;
      RI.set("A" + rr, s.name + (j === 4 ? `（売上−${Math.round(dzV * 100)}%）` : ""), ST.label, j === 4 ? `${p("comp_y")}&"年目に近くへ競合出店（売上−"&TEXT(${p("dz")},"0%")&"）"` : null);
      RI.set("C" + rr, s.pb ? s.pb + "年目" : "10年内は未達", ST.cell, PB(`'10年収支計画'!$B$${s.rr}:$K$${s.rr}`));
      RI.set("D" + rr, Math.round(s.cum), ST.man, `'10年収支計画'!K${s.rr}`);
    });
    // 3年目の月の手残り＝（3年目の累計−2年目の累計）÷12
    scen.forEach((s, j) => RI.set("B" + (7 + j), Math.round(s.m3p), ST.man, `('10年収支計画'!D${s.rr}-'10年収支計画'!C${s.rr})/12`));
    const y3 = Y[2], fixM = (y3.rnt + y3.l1 + y3.l2 + y3.f) / 12, be = fixM / (1 - runPct), beP = sales ? be * 1e4 / sales : 0;
    const lowI = SEASON.indexOf(Math.min(...SEASON)), low = sales * SEASON[lowI], lowProf = (low / 1e4) * (1 - runPct) - fixM;
    RI.set("A13", "赤字にならない月の売上（3年目）", ST.labelB).set("B13", Math.round(be), ST.manB, `SUM('10年収支計画'!D10:D13)/12/(1-${p("run")})`);
    RI.set("C13", `予測の${Math.round(beP * 100)}%`, ST.cell, `"予測の"&TEXT(B13*10000/${p("sales")},"0%")`); RI.merges.push("C13:D13");
    RI.set("A14", `いちばん少ない月（${lowI + 1}月）の手残り`, ST.labelB).set("B14", Math.round(lowProf), ST.manB, `${p("sales")}*MIN(${seasRef(0)}:${seasRef(11)})/10000*(1-${p("run")})-SUM('10年収支計画'!D10:D13)/12`);
    RI.set("C14", `月の売上 ${man(low)}万円の見込み`, ST.cell, `"月の売上 "&TEXT(${p("sales")}*MIN(${seasRef(0)}:${seasRef(11)})/10000,"#,##0")&"万円の見込み"`); RI.merges.push("C14:D14");
    RI.set("A15", "試算は10年収支計画と同じ前提（借入・家賃・ランニングコスト率）で、売上や費用だけを変えています。", ST.note); RI.merges.push("A15:D15");
    RI.set("F6", "リスクと当社の対策", ST.headL);
    const R20 = scen[2], pbT = (s) => (s.pb ? s.pb + "年目" : "10年内は未達");
    const RK = [
      ["売上が予測を下回る", `売上が20%下がると3年目の月の手残りは${Math.round(R20.m3p)}万円、黒字化は${pbT(R20)}。月の売上${man(be * 1e4)}万円（予測の${Math.round(beP * 100)}%）を下回ると赤字です。`, "開業時のチラシ・SNS告知とLINE会員の獲得。利用データを毎月確認し、価格・コースを見直します。"],
      ["近くに競合店ができる", `店の広さ${ts.toFixed(1)}坪で競合への強さは「${defLv}」。${compY}年目に出店された場合、10年累計は${Math.round(scen[4].cum)}万円の見込みです。`, "広さ・大型機・清潔感で選ばれる店づくり。日々の清掃と、ゆっくり待てる店内で常連のお客様を守ります。"],
      ["電気・ガス代が上がる", `電気・ガス代が20%上がると、10年累計で${Math.round(scen[0].cum - scen[3].cum)}万円の減少です。`, "ガス乾燥機の効率的な運転設定、省エネ機種の採用、必要に応じた料金の改定で吸収します。"],
      ["売上の少ない月", `いちばん少ない${lowI + 1}月は月の売上${man(low)}万円の見込み。この月の手残りは${Math.round(lowProf)}万円です。`, "年末・梅雨の多い月の手残りで少ない月の返済をまかなえるよう、運転資金を確保して開業します。"],
      ["機械の故障・停止", "止まっている間は売上が出ず、お客様の不満にもつながります。", "メーカー保守と遠隔監視で異常をすぐ把握し、部品の手配と修理の体制を整えています。"],
      ["防犯・店内トラブル", "無人店舗のため、いたずら・盗難・忘れ物などが起こりえます。", "防犯カメラと遠隔での見守り、夜間も明るい照明、問い合わせ窓口の掲示で対応します。"],
      ...(d.risks || []).filter((t) => !/^(天候|機械の故障)/.test(t)).map((t) => { const [a, b] = t.split(" → "); return [a, "この候補地で気になる点", b || ""]; }),
    ];
    RI.cols = []; RI.width("A", 34).width("B", 16).width("C", 16).width("D", 16).width("E", 3).width("F", 22).width("G", 40).width("H", 44);
    ["リスク", "想定される影響", "当社の対策"].forEach((h, i) => RI.set(colName(5 + i) + "7", h, ST.head)); RI.merges.push("F6:H6");
    RK.forEach((x, j) => { const rr = 8 + j; RI.set("F" + rr, x[0], ST.labelB).set("G" + rr, x[1], ST.inText).set("H" + rr, x[2], ST.inText); RI.heights[rr] = 48; });

    // ===== 売上予測 =====
    const SA = mk("売上予測", { A: 34, B: 22, C: 44, D: 4, E: 10, F: 12, G: 12 });
    head(SA, 6, "SALES FORECAST", "売上予測", "ランドリープレスの売上実績をもとにした、ランドリーオープンナビの売上予測", "G");
    SA.set("A6", "判定", ST.labelB).set("B6", `${d.est.mark} ${d.est.markText}`, ST.cellB); SA.merges.push("B6:C6");
    SA.set("A7", "月の売上の見込み（3年目）", ST.labelB).set("B7", d.est.bandText, ST.cellB); SA.merges.push("B7:C7");
    SA.set("A8", "計画に使う月の売上", ST.labelB).set("B8", Math.round(sales / 1e4), ST.manB, `${p("sales")}/10000`).set("C8", A.salesNote || "", ST.note);
    SA.set("A9", "1日の利用見込み（3年目）", ST.labelB).set("B9", Math.round(sales / A.price / 30), ST.intB, `${p("sales")}/${p("price")}/30`).set("C9", "月の売上 ÷ 客単価 ÷ 30日（回）", ST.note);
    SA.set("A10", "商圏だけで見た基準", ST.label).set("B10", d.est.baseText, ST.cell); SA.merges.push("B10:C10");
    SA.set("A11", "お店の条件の合計点", ST.label).set("B11", d.est.ptText, ST.cell); SA.merges.push("B11:C11");
    let sr = 13;
    SA.set("A" + sr, "予測に効いている要因", ST.h2); sr++;
    ["要因", "この候補地", "見方"].forEach((h, i) => SA.set(colName(i) + sr, h, ST.head)); sr++;
    d.est.cond.forEach((c) => { SA.set("A" + sr, c.label, ST.label).set("B" + sr, c.value, ST.cell).set("C" + sr, c.note, ST.cell); sr++; });
    sr++; SA.set("A" + sr, "お店の条件（直営店の標準的なつくりを0点として）", ST.h2); sr++;
    ["項目", "選んだもの", "点数"].forEach((h, i) => SA.set(colName(i) + sr, h, ST.head)); sr++;
    d.spec.forEach((x) => { SA.set("A" + sr, x.label, ST.label).set("B" + sr, x.choice, ST.cell).set("C" + sr, x.pt, ST.int); sr++; });
    (d.checks || []).forEach((x) => { SA.set("A" + sr, x.label, ST.label).set("B" + sr, x.choice, ST.cell).set("C" + sr, "参考チェック", ST.note); sr++; });
    SA.set("A" + (sr + 1), "※お店の条件は合計4点ごとに、売上の見込み（20万円きざみ）を1段階上げ下げしています。予測は当社の出店実績と公的統計にもとづく推計であり、売上を保証するものではありません。", ST.note);
    SA.merges.push(`A${sr + 1}:C${sr + 1}`); SA.heights[sr + 1] = 32;
    SA.set("E6", "月別の売上目安（3年目）", ST.headL); SA.merges.push("E6:G6");
    ["月", "売上の割合", "売上（万円）"].forEach((h, i) => SA.set(colName(4 + i) + "7", h, ST.head));
    SEASON.forEach((s, i) => { const rr = 8 + i; SA.set("E" + rr, `${i + 1}月`, ST.label).set("F" + rr, s, ST.pct0, seasRef(i)).set("G" + rr, Math.round(sales * s / 1e4), ST.int, `${p("sales")}*F${rr}/10000`); });
    SA.set("E20", "年平均", ST.labelB).set("G20", Math.round(sales / 1e4), ST.intB, `${p("sales")}/10000`);
    SA.set("E21", "年商", ST.labelB).set("G21", Math.round(sales * 12 / 1e4), ST.intB, `${p("sales")}*12/10000`);
    SA.set("E22", "年末の大物洗い・梅雨・花粉の時期が高く、夏の終わりは落ち着きます。", ST.note); SA.merges.push("E22:G22"); SA.heights[22] = 30;

    // ===== 競合店調査 =====
    const CP = mk("競合店調査", { A: 6, B: 40, C: 10, D: 12, E: 50 });
    head(CP, 5, "COMPETITORS", "競合店調査", "商圏内のコインランドリー（候補地から近い順）", "E");
    const comps = (d.comps || []).filter((c) => c.ring !== "商圏外");
    const n1 = comps.filter((c) => c.ring === "第1商圏").length, n2 = comps.length - n1;
    CP.set("A6", "", ST.n).set("B6", "第1商圏の競合店", ST.labelB).set("C6", n1, ST.intB); CP.set("D6", "店", ST.n);
    CP.set("B7", "第2商圏の競合店", ST.labelB).set("C7", n2, ST.intB); CP.set("D7", "店", ST.n);
    CP.set("B8", d.compText || "", ST.cell); CP.merges.push("B8:E8"); CP.heights[8] = 48;
    ["番号", "店名", "距離", "範囲", "住所"].forEach((h, i) => CP.set(colName(i) + "10", h, ST.head));
    comps.slice(0, 60).forEach((c, i) => { const rr = 11 + i; CP.set("A" + rr, i + 1, ST.int).set("B" + rr, c.name, ST.cell).set("C" + rr, +c.km.toFixed(2), ST.km).set("D" + rr, c.ring, ST.cell).set("E" + rr, c.address || "", ST.cell); });
    if (!comps.length) CP.set("B11", "商圏内に見つかりませんでした", ST.cell);
    const cEnd = 11 + Math.max(1, Math.min(60, comps.length)) + 1;
    CP.set("A" + cEnd, `他社店舗は ${d.compSrc || "地図データ"} から調べています（登録されていない店もあります）。清潔感・機械の新しさ・大型機の有無は、現地とGoogleの写真・口コミで確かめてください。`, ST.note); CP.merges.push(`A${cEnd}:E${cEnd}`); CP.heights[cEnd] = 30;
    CP.landscape = false; CP.fitH = 0;

    // ===== 商圏分析 =====
    const AR = mk("商圏分析", { A: 26, B: 13, C: 13, D: 11, E: 12, F: 15, G: 15 });
    head(AR, 4, "TRADE AREA", "商圏分析", "国勢調査2020（500mメッシュ）を候補地からの距離で集計", "G");
    const ring = d.areaRows;
    ["範囲", "世帯数", "人口", "世帯人員", "単身世帯", "6歳未満の子がいる世帯", "65歳以上がいる世帯"].forEach((h, i) => AR.set(colName(i) + "6", h, ST.head));
    ring.forEach((x, i) => {
      const rr = 7 + i, hh = Math.max(1, x.hh);
      AR.set("A" + rr, x.label, x.sum ? ST.labelB : ST.label).set("B" + rr, Math.round(x.hh), ST.int).set("C" + rr, Math.round(x.pop), ST.int)
        .set("D" + rr, x.hh ? +(x.pop / x.hh).toFixed(2) : 0, ST.dec2, `IF(B${rr}=0,0,C${rr}/B${rr})`)
        .set("E" + rr, x.single != null ? x.single / hh : "−", x.single != null ? ST.pct0 : ST.cell)
        .set("F" + rr, x.kids != null ? x.kids / hh : "−", x.kids != null ? ST.pct : ST.cell)
        .set("G" + rr, x.senior != null ? x.senior / hh : "−", x.senior != null ? ST.pct0 : ST.cell);
    });
    let ar = 7 + ring.length + 1;
    if (d.bands) {
      AR.set("A" + ar, "距離帯ごとの世帯数", ST.h2); ar++;
      d.bands.forEach(([l, hh]) => { AR.set("A" + ar, l, ST.label).set("B" + ar, Math.round(hh), ST.int); ar++; });
      ar++;
    }
    AR.set("A" + ar, d.areaText || "", ST.cell); AR.merges.push(`A${ar}:G${ar}`); AR.heights[ar] = 44; ar++;
    AR.set("A" + ar, "ターゲット：" + (d.target || ""), ST.cell); AR.merges.push(`A${ar}:G${ar}`); AR.heights[ar] = 44; ar++;
    AR.set("A" + ar, "洗濯物の多い家族世帯、特に小さな子どもがいる世帯は大型洗濯乾燥機の主な利用者です。単身世帯の多い地域（マンションが多い地域）はコインランドリーの利用が見込みやすくなります。出典：総務省統計局 令和2年国勢調査 地域メッシュ統計。", ST.note);
    AR.merges.push(`A${ar}:G${ar}`); AR.heights[ar] = 30;

    // ===== 計画地の概要 =====
    const OV = mk("計画地の概要", { A: 26, B: 46, C: 4, D: 34, E: 14, F: 12 });
    head(OV, 2, "SITE OVERVIEW", "計画地の概要", "候補地の条件と、立地の調査結果", "F");
    const mcF = `"洗濯乾燥機"&${cntF("洗濯乾燥機")}&"台・乾燥機"&${cntF("乾燥機")}&"台・洗濯機"&${cntF("洗濯機")}&"台"&IF(${cntF("スニーカー")}>0,"・スニーカー"&${cntF("スニーカー")}&"台","")`;
    const mcV = `洗濯乾燥機${C.wd}台・乾燥機${C.dr}台・洗濯機${C.wa}台${C.sn ? `・スニーカー${C.sn}台` : ""}`;
    const kv = [
      ["店舗名", v("name"), p("name")], ["所在地", d.matched || d.address, null], ["出店形態", v("fmt"), p("fmt")],
      ["店舗面積", `${v("area")}㎡（約${ts.toFixed(1)}坪）／駐車場 ${v("park")}台`, `${p("area")}&"㎡（約"&TEXT(${p("tsubo")},"0.0")&"坪）／駐車場 "&${p("park")}&"台"`],
      ["機械構成", mcV, mcF], ["競合への強さ", `${defLv}（${ts.toFixed(1)}坪：競合出店時の売上減少 ${Math.round(dzV * 100)}%想定）`, `${p("defLv")}&"（"&TEXT(${p("tsubo")},"0.0")&"坪：競合出店時の売上減少 "&TEXT(${p("dz")},"0%")&"想定）"`],
      ["商圏設定", `第1商圏 ${ring[0].label.replace(/^第1商圏/, "")}／第2商圏 ${ring[1].label.replace(/^第2商圏/, "")}`, null],
      ["用途地域", d.zone || "（調べられませんでした）", null],
    ];
    OV.set("A6", "計画の概要", ST.h2);
    kv.forEach(([l, val, f], i) => OV.set("A" + (7 + i), l, ST.labelB).set("B" + (7 + i), val, ST.cell, f));
    let orow = 7 + kv.length + 1;
    OV.set("A" + orow, "立地の条件（現地で確認）", ST.h2); orow++;
    ["項目", "この候補地"].forEach((h, i) => OV.set(colName(i) + orow, h, ST.head)); orow++;
    d.spec.forEach((x) => { OV.set("A" + orow, x.label, ST.label).set("B" + orow, x.choice, ST.cell); orow++; });
    OV.set("D6", "評価のポイント", ST.h2); OV.merges.push("D6:F6");
    let prow = 7;
    (d.strengths || []).forEach((t) => { OV.set("D" + prow, "強み　" + t, ST.inText); OV.merges.push(`D${prow}:F${prow}`); OV.heights[prow] = 32; prow++; });
    (d.risks || []).forEach((t) => { OV.set("D" + prow, "注意　" + t, ST.inText); OV.merges.push(`D${prow}:F${prow}`); OV.heights[prow] = 32; prow++; });

    // ===== 計画の要点（1枚目） =====
    const SU = mk("計画の要点", { A: 3, B: 22, C: 22, D: 22, E: 22, F: 3, G: 22, H: 44 });
    head(SU, 1, "SUMMARY", "計画の要点", "候補地の評価と、収支の要点", "H");
    SU.set("B6", "予測月商（開業3年目）", ST.kpiL).set("C6", "", ST.kpiL).set("D6", "判定", ST.kpiL).set("E6", "", ST.kpiL); SU.merges.push("B6:C6", "D6:E6");
    SU.set("B7", Math.round(sales / 1e4), ST.kpiV, `${p("sales")}/10000`).set("C7", "", ST.kpiV).set("D7", d.est.mark, ST.kpiT).set("E7", "", ST.kpiT); SU.merges.push("B7:C7", "D7:E7"); SU.heights[7] = 36;
    SU.set("B8", `年商 約${man(sales * 12)}万円／初年度 ${man(sales * RAMP[0])}万円 → 4年目以降 ${man(sales * RAMP[3])}〜${man(sales * RAMP[4])}万円`, ST.kpiS,
      `"年商 約"&TEXT(${p("sales")}*12/10000,"#,##0")&"万円／初年度 "&TEXT(${p("sales")}*${rampRef(0)}/10000,"#,##0")&"万円 → 4年目以降 "&TEXT(${p("sales")}*${rampRef(3)}/10000,"#,##0")&"〜"&TEXT(${p("sales")}*${rampRef(4)}/10000,"#,##0")&"万円"`);
    SU.set("C8", "", ST.kpiS).set("D8", `${d.est.markText}（${d.est.bandText}）`, ST.kpiS).set("E8", "", ST.kpiS); SU.merges.push("B8:C8", "D8:E8"); SU.heights[8] = 30;
    const kp = [
      ["初期投資（税込）", Math.round(invT / 1e4), `${P.invT.ref}/10000`, "機械・工事・内装の合計", ST.kpiV],
      ["1日の利用見込み", `${Math.round(sales / A.price / 30)}回`, `TEXT(${p("sales")}/${p("price")}/30,"0")&"回"`, `1回${A.price.toLocaleString("ja-JP")}円換算`, ST.kpiT],
      ["累計黒字化", payback ? payback + "年目" : "—", `'10年収支計画'!B20`, "借入返済・家賃を差し引き後", ST.kpiT],
      ["10年間の累計手残り", Math.round(Y[9].cum), `'10年収支計画'!B21`, `借入${y1}年返済で試算`, ST.kpiV],
    ];
    kp.forEach(([l, val, f, sub, s], i) => { const c = colName(1 + i); SU.set(c + "10", l, ST.kpiL).set(c + "11", val, s, f).set(c + "12", sub, ST.kpiS); });
    SU.heights[11] = 34;
    SU.set("B14", "評価のポイント", ST.h2); SU.merges.push("B14:E14");
    let hr = 15;
    const pts = [...(d.strengths || []).slice(0, 4).map((t) => "強み　" + t), ...(d.risks || []).slice(0, 2).map((t) => "注意　" + t)];
    pts.forEach((t) => { SU.set("B" + hr, t, ST.inText); SU.merges.push(`B${hr}:E${hr}`); SU.heights[hr] = 30; hr++; });
    SU.set("G6", "計画の概要", ST.h2); SU.merges.push("G6:H6");
    kv.slice(0, 7).forEach(([l, val, f], i) => { SU.set("G" + (7 + i), l, ST.labelB).set("H" + (7 + i), val, ST.cell, f); SU.heights[7 + i] = Math.max(SU.heights[7 + i] || 0, 30); });
    SU.set("B" + (hr + 1), "本資料の予測は当社の出店実績と公的統計にもとづく推計であり、売上を保証するものではありません。", ST.note); SU.merges.push(`B${hr + 1}:H${hr + 1}`);

    // ===== 表紙 =====
    const CV = mk("表紙", { A: 4, B: 26, C: 26, D: 26, E: 26, F: 26 });
    CV.set("B3", "LAUNDRY PRESS", ST.eyebrow);
    CV.set("B8", "STORE OPENING PLAN", ST.eyebrow);
    CV.set("B9", "出店計画書", ST.cover); CV.heights[9] = 54;
    CV.set("B11", v("name"), ST.coverS, p("name")); CV.heights[11] = 26;
    CV.set("B12", d.matched || d.address, ST.n);
    CV.set("B16", "CLIENT", ST.eyebrow).set("B17", v("client") ? v("client") + "　御中" : "", ST.textBig, `IF(${p("client")}="","",${p("client")}&"　御中")`);
    CV.set("D16", "DATE", ST.eyebrow).set("D17", d.created || "", ST.n);
    CV.set("B20", "ランドリープレス", ST.b);
    CV.set("B21", "黄色の欄は書き換えられます。数字は「前提条件」「初期投資」シートの黄色の欄を変えると、全部のシートが計算し直されます。", ST.note); CV.merges.push("B21:F21");

    // 並び（表紙→要点→…→前提条件）
    const order = ["表紙", "計画の要点", "計画地の概要", "商圏分析", "競合店調査", "売上予測", "初期投資", "月間収支", "10年収支計画", "リスクと対策"];
    const out = order.map((n) => sheets.find((s) => s.name === n)); out.push(pre);
    // ページ番号（表紙を除いて 01〜10）を並びに合わせて振り直す
    out.slice(1, 10).forEach((s, i) => { s.set("A2", String(i + 1).padStart(2, "0"), ST.secNo); });
    out.calc = { sales, invT, payback, cum10: Y[9].cum, Y, runPct, pay1, pay2, be, defLv, dz: dzV, tsubo: ts, cap, k: kk, scen, months: SEASON.map((s) => sales * s), counts: C };
    return out;
  }

  async function makeKeikaku(d, type = "blob") {
    const sheets = build(d);
    return PL().toBlob(sheets, type, STYLES, "出店計画書");
  }
  const api = { makeKeikaku, build, EQUIP, OTHER, DEF, RAMP, SEASON };
  root.OpenNaviKeikaku = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
