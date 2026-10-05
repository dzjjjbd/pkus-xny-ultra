// ==UserScript==
// @name         新能源课程系统-收藏页显示全部
// @namespace    pkus-xny-ultra
// @version      0.2.0
// @description  在收藏页未选择教师时，自动聚合展示所有教师的收藏题目；拦截并扩展 condition 请求，原生筛选/删除/标注等功能保持可用
// @match        https://bdfz.xnykcxt.com:5002/stu/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  var XHR = window.XMLHttpRequest;
  if (!XHR || !XHR.prototype) return;

  var COND_RE = /\/api\/collect\/condition(\?|$)/;
  var CATALOG_RE = /\/api\/collect\/catalog(\?|$)/;
  var AUTO_FLAG = "xny-all-collect";

  var teacherList = null;   // [{teacherId, subjectId, teacherName, subjectName}]
  var mode = "IDLE";        // IDLE | ALL | SINGLE
  var pendingTrigger = false;
  var batchSeq = 0;
  var allActive = false;    // 全部模式是否已触发（幂等，防重复）

  function isCollectionRoute() { return location.hash.indexOf("#/collection") === 0; }
  function routeQuery(name) {
    var m = location.hash.match(new RegExp("[?&]" + name + "=([^&]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function applyCatalog(text) {
    try {
      var d = JSON.parse(text);
      if (d && d.code === 0 && Array.isArray(d.extra)) {
        teacherList = d.extra.map(function (x) {
          return { teacherId: x.teacherId, subjectId: x.subjectId, teacherName: x.teacherName, subjectName: x.subjectName };
        });
        if (pendingTrigger) { pendingTrigger = false; tryTrigger(); }
      }
    } catch (e) {}
  }

  function tryTrigger() {
    if (mode !== "ALL" || allActive || routeQuery("tid")) return;
    if (!teacherList) { pendingTrigger = true; return; }
    var t = teacherList[0];
    if (!t) return;
    allActive = true;
    try {
      sessionStorage.setItem("CollectItem-" + t.teacherId, JSON.stringify({
        teacherUserId: t.teacherId, subjectId: t.subjectId,
        userName: t.teacherName, subjectName: t.subjectName
      }));
      sessionStorage.setItem(AUTO_FLAG, String(t.teacherId));
    } catch (e) {}
    // 只带 tid：subid watcher 自然跳过（不发两次请求），点“被预选的这位教师”时也能因 query 变化触发
    location.hash = "#/collection?pageid=" + (routeQuery("pageid") || "3") + "&tid=" + t.teacherId;
    try { window.dispatchEvent(new PopStateEvent("popstate", { state: history.state })); } catch (e) {}
  }

  function onRoute() {
    if (!isCollectionRoute()) { mode = "IDLE"; allActive = false; return; }
    var tid = routeQuery("tid");
    if (tid) {
      if (sessionStorage.getItem(AUTO_FLAG) === tid) { mode = "ALL"; }
      else { mode = "SINGLE"; batchSeq++; allActive = false; }
    } else {
      mode = "ALL";
      tryTrigger();
    }
  }

  function cleanUrl() {
    if (mode !== "ALL") return;
    try {
      history.replaceState(history.state, "", location.pathname + location.search + "#/collection?pageid=" + (routeQuery("pageid") || "3"));
    } catch (e) {}
  }

  // vue-router 应用内导航走 history.pushState（不触发 hashchange），需一并监听
  ["pushState", "replaceState"].forEach(function (name) {
    var orig = history[name];
    if (typeof orig === "function") {
      history[name] = function () { var r = orig.apply(this, arguments); onRoute(); return r; };
    }
  });
  window.addEventListener("hashchange", onRoute);
  window.addEventListener("popstate", onRoute);

  // 侧边栏点击具体教师 → 退出聚合，直通单教师
  document.addEventListener("click", function (e) {
    if (e.target && e.target.closest && e.target.closest(".folderName")) {
      mode = "SINGLE"; batchSeq++; allActive = false;
      try { sessionStorage.removeItem(AUTO_FLAG); } catch (err) {}
    }
  }, true);

  // ---- XHR 补丁：只拦截 condition，用实例属性遮蔽伪造响应；其余请求原样走原生 ----
  var origOpen = XHR.prototype.open;
  var origSetHeader = XHR.prototype.setRequestHeader;
  var origSend = XHR.prototype.send;

  XHR.prototype.open = function (m, u) {
    this.__method = m; this.__url = u || "";
    return origOpen.apply(this, arguments);
  };
  XHR.prototype.setRequestHeader = function (k, v) {
    (this.__headers = this.__headers || {})[k] = v;
    return origSetHeader.apply(this, arguments);
  };
  XHR.prototype.send = function (body) {
    var url = this.__url || "";
    if (COND_RE.test(url) && mode === "ALL" && teacherList && teacherList.length) {
      aggregate(this, body);
      return;
    }
    if (CATALOG_RE.test(url)) {
      var xhr = this;
      xhr.addEventListener("load", function () { applyCatalog(xhr.responseText); }, { once: true });
    }
    return origSend.apply(this, arguments);
  };

  function respond(xhr, text) {
    try {
      Object.defineProperty(xhr, "readyState", { configurable: true, value: 4 });
      Object.defineProperty(xhr, "status", { configurable: true, value: 200 });
      Object.defineProperty(xhr, "statusText", { configurable: true, value: "OK" });
      Object.defineProperty(xhr, "responseText", { configurable: true, value: text });
      Object.defineProperty(xhr, "response", { configurable: true, value: text });
      Object.defineProperty(xhr, "responseURL", { configurable: true, value: xhr.__url || "" });
      xhr.getAllResponseHeaders = function () { return "content-type: application/json\r\n"; };
    } catch (e) {}
    if (typeof xhr.onreadystatechange === "function") { try { xhr.onreadystatechange(); } catch (e) {} }
    if (typeof xhr.onloadend === "function") { try { xhr.onloadend(); } catch (e) {} }
    else if (typeof xhr.onload === "function") { try { xhr.onload(); } catch (e) {} }
  }

  function aggregate(xhr, body) {
    var base = {};
    try { base = body ? JSON.parse(body) : {}; } catch (e) {}
    var seq = ++batchSeq;
    var hs = {};
    for (var k in (xhr.__headers || {})) {
      if (/^(host|content-length|connection|accept-encoding|user-agent|cookie|origin|referer)$/i.test(k)) continue;
      hs[k] = xhr.__headers[k];
    }
    var jobs = teacherList.map(function (t) {
      return fetch(xhr.__url, {
        method: xhr.__method || "POST",
        headers: hs,
        body: JSON.stringify({
          subjectId: t.subjectId, teacherId: t.teacherId,
          contentType: base.contentType || [], tagIds: base.tagIds || []
        }),
        credentials: "include"
      }).then(function (r) { return r.text(); })
        .then(function (txt) { try { return JSON.parse(txt); } catch (e) { return null; } })
        .catch(function () { return null; });
    });
    Promise.all(jobs).then(function (res) {
      if (seq !== batchSeq || mode !== "ALL") return;
      var merged = [];
      res.forEach(function (r) {
        if (r && r.code === 0 && Array.isArray(r.extra)) merged = merged.concat(r.extra);
      });
      function ts(x) { try { return Date.parse(String((x.content || {}).createTime || "").replace(/-/g, "/")) || 0; } catch (e) { return 0; } }
      merged.sort(function (a, b) { return ts(b) - ts(a); });
      respond(xhr, JSON.stringify({ code: 0, message: "SUCCESS", time: Date.now(), extra: merged }));
      cleanUrl();
    });
  }

  onRoute();
  document.addEventListener("DOMContentLoaded", onRoute);
})();
