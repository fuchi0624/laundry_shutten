// 合言葉で中身を開く（中身は暗号化してあり、合言葉がないと読めません）
(function () {
  "use strict";
  var me = document.currentScript, B = me.getAttribute("data-b"), KS = "sn_k";
  var te = new TextEncoder(), td = new TextDecoder();
  function b64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function tob64(buf) { var s = "", a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  var encP = fetch("version.txt?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; })
    .then(function (v) { return fetch(B + "?v=" + encodeURIComponent(v.trim()), { cache: "no-cache" }); })
    .then(function (r) { if (!r.ok) throw new Error("load"); return r.json(); });

  function open(raw) {
    return encP.then(function (e) {
      return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]).then(function (k) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(e.i) }, k, b64(e.c));
      });
    }).then(function (buf) { return JSON.parse(td.decode(buf)); });
  }
  function derive(pw) {
    return encP.then(function (e) {
      return crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveBits"]).then(function (k) {
        return crypto.subtle.deriveBits({ name: "PBKDF2", salt: b64(e.s), iterations: e.n, hash: "SHA-256" }, k, 256);
      });
    });
  }
  function run(d) {
    var urls = {};
    Object.keys(d.files || {}).forEach(function (f) { urls[f] = URL.createObjectURL(new Blob([d.files[f]], { type: "text/javascript" })); });
    window.__snURL = function (src) { return urls[String(src).split("?")[0]] || src; };
    document.open(); document.write(d.html); document.close();
  }
  function form(msg) {
    var st = document.createElement("style");
    st.textContent = "body{margin:0;background:#fff}#snLock{position:fixed;inset:0;display:grid;place-items:center;background:#fff;padding:24px;font-family:'Hiragino Sans','Noto Sans JP',system-ui,sans-serif}" +
      "#snLock form{width:100%;max-width:320px;display:grid;gap:14px;text-align:center}" +
      "#snLock img{width:84px;height:84px;border-radius:20px;margin:0 auto;box-shadow:0 6px 18px rgba(0,0,0,.14)}" +
      "#snLock h1{font-size:18px;margin:0;color:#1d1d1f}#snLock p{margin:0;font-size:13px;color:#6e6e73}" +
      "#snLock input{font-size:17px;padding:12px 14px;border:1.5px solid #e4e2dd;border-radius:12px;text-align:center}" +
      "#snLock input:focus{outline:none;border-color:#ec6a1e}" +
      "#snLock button{font-size:16px;font-weight:700;padding:13px;border:0;border-radius:12px;background:#ec6a1e;color:#fff}" +
      "#snLock button:disabled{opacity:.6}#snLock .err{color:#d0453a;min-height:1.2em}";
    document.head.appendChild(st);
    var w = document.createElement("div"); w.id = "snLock";
    w.innerHTML = '<form><img src="apple-touch-icon.png?v=10" alt=""><h1>ランドリースポットナビ</h1><p>合言葉を入れてください</p>' +
      '<input type="password" autocomplete="current-password" aria-label="合言葉"><button type="submit">ひらく</button><p class="err" aria-live="polite"></p></form>';
    document.body.appendChild(w);
    var f = w.querySelector("form"), i = w.querySelector("input"), e = w.querySelector(".err"), btn = w.querySelector("button");
    if (msg) e.textContent = msg;
    f.addEventListener("submit", function (ev) {
      ev.preventDefault(); btn.disabled = true; e.textContent = "";
      var raw;
      derive(i.value.trim()).then(function (r) { raw = r; return open(r); }).then(function (d) {
        try { localStorage.setItem(KS, tob64(raw)); } catch (x) {}
        run(d);
      }).catch(function (x) {
        btn.disabled = false;
        e.textContent = x && x.message === "load" ? "読み込めませんでした。電波のよい所でもう一度お試しください" : "合言葉がちがいます";
        i.select();
      });
    });
    setTimeout(function () { i.focus(); }, 100);
  }
  function start() {
    var saved = null;
    try { saved = localStorage.getItem(KS); } catch (x) {}
    if (!saved) return form();
    open(b64(saved)).then(run).catch(function (x) {
      if (x && x.message === "load") return form("読み込めませんでした。電波のよい所でもう一度お試しください");
      try { localStorage.removeItem(KS); } catch (y) {}
      form();
    });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
