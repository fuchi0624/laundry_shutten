// 事業計画書（スマホで見る）をPDFにする。印刷画面を使わない（ホーム画面のアプリでは印刷が開かないため）。
// 画面と同じ内容を A4縦の画像に描いて、画像を並べたPDFを作る（外部のライブラリは使わない）。
(function () {
  const W = 1240, H = 1754, M = 76, CW = W - M * 2, BOTTOM = H - 90;
  const BODY = '"Zen Kaku Gothic New","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","IPAPGothic",sans-serif';
  const DISP = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN",' + BODY;
  const NUM = '"Outfit",' + DISP;
  const C = { ink: "#2b1e15", muted: "#7f6e61", line: "#eadccf", surf: "#fbf6f1", acc: "#e2621b", deep: "#b9480f", soft: "#fde8d9", ok: "#2fae74", ng: "#d9534f", dark: "#1b120b" };

  function rr(x, y, w, h, r) { const p = new Path2D(); p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r); p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath(); return p; }

  async function make(blocks, opt = {}) {
    try { await Promise.all(["800 30px \"M PLUS Rounded 1c\"", "700 30px \"Outfit\"", "400 24px \"Zen Kaku Gothic New\"", "700 24px \"Zen Kaku Gothic New\""].map((f) => document.fonts.load(f, "事業計画書0123"))); } catch (e) { /* 読めなくても端末の文字で描く */ }
    const pages = []; let cv, g, y;
    const newPage = () => {
      cv = document.createElement("canvas"); cv.width = W; cv.height = H; g = cv.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.textBaseline = "alphabetic"; pages.push(cv); y = M;
    };
    const ensure = (h) => { if (y + h > BOTTOM) newPage(); };
    const font = (size, w = 400, fam = BODY) => { g.font = `${w} ${size}px ${fam}`; };
    const txt = (t, x, yy, color = C.ink, align = "left") => { g.fillStyle = color; g.textAlign = align; g.fillText(String(t), x, yy); g.textAlign = "left"; };
    const wrap = (t, maxW) => {
      const out = []; for (const para of String(t).split("\n")) {
        let line = ""; for (const ch of para) { if (g.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch; }
        out.push(line);
      } return out;
    };
    const para = (t, size, color, lh = 1.6, x = M, w = CW, wgt = 400) => { font(size, wgt); for (const l of wrap(t, w)) { ensure(size * lh); font(size, wgt); txt(l, x, y + size, color); y += size * lh; } };
    const box = (x, yy, w, h, fill, stroke, r = 18) => { const p = rr(x, yy, w, h, r); if (fill) { g.fillStyle = fill; g.fill(p); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(p); } };
    const imgs = await Promise.all(blocks.filter((b) => b.t === "photos").flatMap((b) => b.items).map((it) => new Promise((ok) => {
      const im = new Image(); im.onload = () => ok([it, im]); im.onerror = () => ok([it, null]); im.src = it.src;
    })));
    const imgOf = new Map(imgs);
    newPage();
    for (const b of blocks) {
      if (b.t === "hero") {
        const h = 250; ensure(h);
        const p = rr(M, y, CW, h, 26); g.save(); g.clip(p);
        const gr = g.createLinearGradient(M, y, M + CW, y + h); gr.addColorStop(0, "#120c08"); gr.addColorStop(0.6, "#1d130c"); gr.addColorStop(1, "#5a2a10");
        g.fillStyle = gr; g.fillRect(M, y, CW, h);
        g.shadowColor = "rgba(255,120,40,.8)"; g.shadowBlur = 24; g.strokeStyle = "rgba(255,140,70,.85)"; g.lineWidth = 3;
        g.beginPath(); g.arc(M + CW - 70, y + 40, 150, 0, Math.PI * 2); g.stroke(); g.restore();
        font(20, 700, NUM); g.save(); g.letterSpacing = "6px"; txt(b.eye, M + 40, y + 58, "#ff8a45"); g.restore();
        font(56, 800, DISP); txt(b.title, M + 40, y + 124, "#fff");
        font(30, 700); txt(b.name, M + 40, y + 170, "#fff");
        font(21); b.sub.forEach((s, i) => txt(s, M + 40, y + 206 + i * 30, "#d8c7b8"));
        y += h + 22;
      } else if (b.t === "kpi") {
        const gap = 16, half = (CW - gap) / 2;
        const one = (it, x, w, h, main) => {
          box(x, y, w, h, main ? C.soft : C.surf, main ? C.acc : C.line);
          font(20); txt(it.label, x + 24, y + 38, C.muted);
          font(main ? 64 : 46, 700, NUM); txt(it.value, x + 24, y + (main ? 108 : 94), main ? C.deep : C.ink);
          const vw = g.measureText(it.value).width; font(main ? 26 : 22, 700, DISP); txt(it.unit || "", x + 30 + vw, y + (main ? 108 : 94), main ? C.deep : C.ink);
          font(19); txt(it.note || "", x + 24, y + h - 22, C.muted);
        };
        const [first, ...rest] = b.items; ensure(166); one(first, M, CW, 166, true); y += 166 + gap;
        for (let i = 0; i < rest.length; i += 2) { ensure(146); one(rest[i], M, half, 146); if (rest[i + 1]) one(rest[i + 1], M + half + gap, half, 146); y += 146 + gap; }
      } else if (b.t === "judge") {
        ensure(110); const col = b.ok ? C.ok : C.ng;
        box(M, y, CW, 104, b.ok ? "#eaf7f0" : "#fbeaea", null, 16); g.fillStyle = col; g.fillRect(M, y, 8, 104);
        font(30, 800, DISP); txt(b.text, M + 32, y + 46, C.ink); font(21); txt(b.sub, M + 32, y + 84, C.muted);
        y += 104 + 10;
      } else if (b.t === "h2") {
        ensure(b.keep || 200); y += 26;
        g.fillStyle = C.acc; g.fillRect(M, y, 7, 38);
        font(32, 800, DISP); txt(b.text, M + 22, y + 32, C.ink);
        if (b.small) { font(20); txt(b.small, M + CW, y + 30, C.muted, "right"); }
        y += 56;
      } else if (b.t === "table") {
        const rh = 50, ws = b.widths, xs = []; let acc = M; ws.forEach((w) => { xs.push(acc); acc += w * CW; });
        ensure(rh * (b.rows.length + 1));
        const top = y, p = rr(M, y, CW, rh * (b.rows.length + 1), 16); g.save(); g.clip(p);
        g.fillStyle = C.dark; g.fillRect(M, y, CW, rh);
        font(20, 700); b.head.forEach((h, i) => { if (h) txt(h, i ? xs[i] + ws[i] * CW - 16 : xs[i] + 16, y + 33, "#fff", i ? "right" : "left"); });
        y += rh;
        b.rows.forEach((r, ri) => {
          g.fillStyle = r.strong ? C.surf : "#fff"; g.fillRect(M, y, CW, rh);
          if (ri) { g.fillStyle = C.line; g.fillRect(M, y, CW, 2); }
          r.cells.forEach((cl, i) => {
            const last = ri === b.rows.length - 1 && b.lastAccent;
            font(i ? 23 : 21, r.strong ? 800 : i ? 500 : 400, i ? NUM : BODY);
            const col = r.neg && r.neg[i] ? C.ng : last ? C.deep : C.ink;
            txt(cl, i ? xs[i] + ws[i] * CW - 16 : xs[i] + 16, y + 34, col, i ? "right" : "left");
          });
          y += rh;
        });
        g.restore(); g.strokeStyle = C.line; g.lineWidth = 2; g.stroke(rr(M, top, CW, y - top, 16));
        y += 8;
      } else if (b.t === "note") {
        if (!b.text) continue; y += 6; para(b.text, 19, C.muted, 1.65);
      } else if (b.t === "photos") {
        const gap = 16, w = (CW - gap) / 2, ih = Math.round(w * 42 / 64); ensure(ih + 70);
        b.items.forEach((it, i) => {
          const x = M + i * (w + gap), im = imgOf.get(it);
          g.save(); g.clip(rr(x, y, w, ih, 16));
          if (im) { const s = Math.max(w / im.width, ih / im.height), dw = im.width * s, dh = im.height * s; g.drawImage(im, x + (w - dw) / 2, y + (ih - dh) / 2, dw, dh); } else { g.fillStyle = C.surf; g.fillRect(x, y, w, ih); }
          g.restore();
          font(20, 700); txt(it.label, x, y + ih + 30, C.ink); font(17); txt(it.attr || "", x, y + ih + 56, C.muted);
        });
        y += ih + 70;
      } else if (b.t === "score") {
        const h = 40 + b.items.length * 40; ensure(h);
        box(M, y, CW, h, C.surf, C.line, 16);
        font(84, 700, NUM); txt(b.total, M + 40, y + h / 2 + 30, C.deep); const tw = g.measureText(b.total).width; font(28, 700, DISP); txt("点", M + 46 + tw, y + h / 2 + 30, C.deep);
        const x0 = M + 260, bw = CW - 260 - 110;
        b.items.forEach((it, i) => {
          const yy = y + 34 + i * 40; font(20); txt(it.name, x0, yy, C.ink);
          const bx = x0 + 230, bl = bw - 230; box(bx, yy - 16, bl, 14, C.line, null, 7); if (it.w > 0) box(bx, yy - 16, Math.max(14, bl * it.w), 14, C.acc, null, 7);
          font(22, 700, NUM); txt(it.v, M + CW - 30, yy, C.ink, "right");
        });
        y += h + 8;
      } else if (b.t === "cards") {
        const gap = 16, w = (CW - gap) / 2, h = 120;
        for (let i = 0; i < b.items.length; i += 2) {
          ensure(h);
          [b.items[i], b.items[i + 1]].forEach((it, k) => {
            if (!it) return; const x = M + k * (w + gap); box(x, y, w, h, C.surf, C.line, 16);
            font(19); txt(it.label, x + 22, y + 34, C.muted);
            font(38, 700, NUM); txt(it.value, x + 22, y + 78, C.ink); const vw = g.measureText(it.value).width; font(19, 700); txt(it.unit, x + 28 + vw, y + 78, C.ink);
            font(18); txt(it.sub, x + 22, y + 106, C.muted);
          });
          y += h + gap;
        }
      } else if (b.t === "dl") {
        const rh = 50; ensure(rh * b.items.length); const top = y;
        b.items.forEach(([k, v], i) => {
          if (i) { g.fillStyle = C.line; g.fillRect(M, y, CW, 2); }
          font(21); txt(k, M + 20, y + 33, C.muted); font(22, 700); txt(v, M + CW - 20, y + 33, C.ink, "right"); y += rh;
        });
        g.strokeStyle = C.line; g.lineWidth = 2; g.stroke(rr(M, top, CW, y - top, 16)); y += 8;
      } else if (b.t === "list") {
        for (const it of b.items) { font(22); const ls = wrap(it, CW - 40); ensure(ls.length * 36); font(22); ls.forEach((l, i) => { if (!i) { g.fillStyle = C.acc; g.beginPath(); g.arc(M + 12, y + 18, 5, 0, Math.PI * 2); g.fill(); } txt(l, M + 34, y + 26, C.ink); y += 36; }); }
      } else if (b.t === "foot") {
        y += 24; ensure(80); g.fillStyle = C.line; g.fillRect(M, y, CW, 2); y += 14; para(b.text, 17, C.muted, 1.6);
      }
    }
    // ページ番号
    pages.forEach((p, i) => { const c = p.getContext("2d"); c.font = `400 18px ${BODY}`; c.fillStyle = C.muted; c.textAlign = "center"; c.fillText(`${i + 1} / ${pages.length}`, W / 2, H - 44); c.textAlign = "right"; c.fillText(opt.footer || "", W - M, H - 44); });
    return toPdf(await Promise.all(pages.map((p) => new Promise((ok) => p.toBlob(async (bl) => ok(new Uint8Array(await bl.arrayBuffer())), "image/jpeg", 0.88)))));
  }

  // JPEG画像を1ページずつ並べたPDF（A4縦）
  function toPdf(jpgs) {
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); body.forEach(push); push("\nendobj\n"); };
    push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    const n = jpgs.length, kids = [];
    for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
    obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
    obj(2, [`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${n} >>`]);
    jpgs.forEach((j, i) => {
      const p = 3 + i * 3, c = p + 1, im = p + 2, cs = "q 595.28 0 0 841.89 0 0 cm /Im0 Do Q";
      obj(p, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${c} 0 R >>`]);
      obj(c, [`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`]);
      obj(im, [`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.length} >>\nstream\n`, j, "\nendstream"]);
    });
    const total = 3 + n * 3, xref = len;
    push(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let i = 1; i < total; i++) push(String(offs[i]).padStart(10, "0") + " 00000 n \n");
    push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: "application/pdf" });
  }

  // 保存：共有シート（iPhoneは「"ファイル"に保存」・LINE・メール）→ だめならダウンロード
  async function save(blob, name) {
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return "shared"; } catch (e) { if (e && e.name === "AbortError") return "cancel"; }
    }
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return "download";
  }

  window.OpenNaviPdf = { make, save, toPdf };
})();
