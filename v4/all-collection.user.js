// ==UserScript==
// @name         新能源课程系统-收藏页显示全部
// @namespace    pkus-xny-ultra
// @version      0.1.0
// @description  在收藏页未选择教师时，自动聚合展示所有教师的收藏题目；拦截并扩展 condition 请求，原生筛选/删除/标注等功能保持可用
// @match        https://bdfz.xnykcxt.com:5002/stu/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  var NativeXHR = window.XMLHttpRequest;
  if (!NativeXHR) return;

  var COND_RE = /\/api\/collect\/condition(\?|$)/;
  var CATALOG_RE = /\/api\/collect\/catalog(\?|$)/;
  var AUTO_FLAG = "xny-all-collect";

  var teacherList = null;   // [{teacherId, subjectId, teacherName, subjectName}]
  var mode = "IDLE";        // IDLE | ALL | SINGLE
  var selfInitiated = false;
  var pendingTrigger = false;
  var batchSeq = 0;
  var urlCleaned = false;
  var inflight = null;      // {key, promise} 同参数批次复用，避免双 watcher 重复请求
  var allActive = false;    // 本次“全部模式”是否已生效（幂等，防重复触发）
  var suppressRoute = false;

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
    selfInitiated = true;
    urlCleaned = false;
    // 只带 tid、不带 subid：既让 subid watcher 跳过（避免双请求），
    // 又保证之后点击“被预选的这位教师”时 query 会有变化、watcher 能触发
    location.hash = "#/collection?pageid=" + (routeQuery("pageid") || "3") + "&tid=" + t.teacherId;
    try { window.dispatchEvent(new PopStateEvent("popstate", { state: history.state })); } catch (e) {}
  }

  function onRoute() {
    if (!isCollectionRoute()) { mode = "IDLE"; allActive = false; return; }
    var tid = routeQuery("tid");
    if (tid) {
      if (selfInitiated) { selfInitiated = false; mode = "ALL"; }
      else if (sessionStorage.getItem(AUTO_FLAG) === tid) { mode = "ALL"; }
      else { mode = "SINGLE"; batchSeq++; allActive = false; }
    } else {
      mode = "ALL";
      tryTrigger();
    }
  }

  // vue-router 的应用内导航用 history.pushState（不触发 hashchange），需一并监听
  function wrapHistory(name) {
    var orig = history[name];
    if (typeof orig !== "function") return;
    history[name] = function () {
      var r = orig.apply(this, arguments);
      if (!suppressRoute) onRoute();
      return r;
    };
  }
  wrapHistory("pushState");
  wrapHistory("replaceState");
  window.addEventListener("hashchange", onRoute);
  window.addEventListener("popstate", onRoute);

  // 侧边栏点击具体教师 → 退出聚合，直通单教师
  document.addEventListener("click", function (e) {
    var el = e.target;
    while (el && el !== document) {
      if (el.classList && el.classList.contains("folderName")) {
        mode = "SINGLE"; batchSeq++; allActive = false;
        try { sessionStorage.removeItem(AUTO_FLAG); } catch (err) {}
        return;
      }
      el = el.parentNode;
    }
  }, true);

  function cleanUrl() {
    if (urlCleaned || mode !== "ALL") return;
    urlCleaned = true;
    var pid = routeQuery("pageid") || "3";
    suppressRoute = true;
    try { history.replaceState(history.state, "", location.pathname + location.search + "#/collection?pageid=" + pid); } catch (e) {}
    suppressRoute = false;
  }

  function HookedXHR() {
    var self = this;
    var native = new NativeXHR();
    var _method = "GET", _url = "", _headers = {}, _body = null;
    var synthetic = false, cancelled = false, listeners = [];

    this.readyState = 0; this.status = 0; this.statusText = "";
    this.responseText = ""; this.response = ""; this.responseURL = "";
    this.responseType = "";
    this.onreadystatechange = null; this.onload = null; this.onloadend = null;
    this.onerror = null; this.onabort = null; this.ontimeout = null;
    this.onloadstart = null; this.onprogress = null;
    this.upload = native.upload;

    Object.defineProperty(this, "timeout", { get: function () { return native.timeout; }, set: function (v) { native.timeout = v; } });
    Object.defineProperty(this, "withCredentials", { get: function () { return native.withCredentials; }, set: function (v) { native.withCredentials = v; } });

    function dispatch(type) {
      var ev = { type: type, target: self, currentTarget: self };
      var h = self["on" + type];
      if (typeof h === "function") { try { h.call(self, ev); } catch (e) {} }
      for (var i = 0; i < listeners.length; i++) { try { listeners[i].call(self, ev); } catch (e) {} }
    }

    this.addEventListener = function (type, fn) { if (typeof fn === "function") listeners.push(fn); };
    this.removeEventListener = function (type, fn) { listeners = listeners.filter(function (l) { return l !== fn; }); };

    this.open = function (m, u, async, user, pwd) {
      _method = m; _url = u || "";
      try { native.open(m, u, async === undefined ? true : async, user, pwd); } catch (e) {}
      self.readyState = 1;
    };
    this.setRequestHeader = function (k, v) { _headers[k] = v; try { native.setRequestHeader(k, v); } catch (e) {} };
    this.getAllResponseHeaders = function () { return synthetic ? "content-type: application/json\r\n" : native.getAllResponseHeaders(); };
    this.getResponseHeader = function (k) { return synthetic ? (String(k).toLowerCase() === "content-type" ? "application/json" : null) : native.getResponseHeader(k); };
    this.overrideMimeType = function (t) { try { native.overrideMimeType(t); } catch (e) {} };
    this.abort = function () {
      cancelled = true;
      try { native.abort(); } catch (e) {}
      if (self.readyState !== 4) { self.readyState = 0; dispatch("abort"); }
    };

    this.send = function (b) {
      _body = b;
      if (COND_RE.test(_url) && mode === "ALL") { aggregate(); return; }
      passthrough();
    };

    function passthrough() {
      native.onreadystatechange = function () {
        self.readyState = native.readyState;
        if (native.readyState >= 2) { self.status = native.status; self.statusText = native.statusText; }
        if (native.readyState === 4) {
          self.responseText = native.responseText;
          self.response = native.response;
          self.responseURL = native.responseURL;
          if (CATALOG_RE.test(_url)) applyCatalog(native.responseText);
        }
        dispatch("readystatechange");
      };
      native.onload = function () { dispatch("load"); dispatch("loadend"); };
      native.onerror = function () { dispatch("error"); };
      native.onabort = function () { dispatch("abort"); };
      native.ontimeout = function () { dispatch("timeout"); };
      try { native.send(_body); } catch (e) { self.readyState = 4; self.status = 0; dispatch("readystatechange"); dispatch("error"); }
    }

    function deliver(text) {
      synthetic = true;
      self.readyState = 4;
      self.status = 200;
      self.statusText = "OK";
      self.responseText = text;
      self.response = text;
      self.responseURL = _url;
      dispatch("readystatechange");
      dispatch("load");
      dispatch("loadend");
    }

    function aggregate() {
      var base = {};
      try { base = _body ? JSON.parse(_body) : {}; } catch (e) {}
      var key = JSON.stringify({ c: base.contentType || [], t: base.tagIds || [] });

      // 同参数批次复用：网站同时有 tid/subid 两个 watcher，会连发两次相同请求
      if (inflight && inflight.key === key) {
        inflight.promise.then(function (merged) {
          if (!cancelled && mode === "ALL") deliver(merged);
        });
        return;
      }

      var seq = ++batchSeq;
      synthetic = true;
      cancelled = false;
      var hs = {};
      for (var k in _headers) {
        if (/^(host|content-length|connection|accept-encoding|user-agent|cookie|origin|referer)$/i.test(k)) continue;
        hs[k] = _headers[k];
      }
      var list = teacherList || [];
      if (!list.length) { synthetic = false; passthrough(); return; }
      var jobs = list.map(function (t) {
        var payload = {
          subjectId: t.subjectId,
          teacherId: t.teacherId,
          contentType: base.contentType || [],
          tagIds: base.tagIds || []
        };
        return fetch(_url, { method: _method, headers: hs, body: JSON.stringify(payload), credentials: "include" })
          .then(function (r) { return r.text(); })
          .then(function (txt) { try { return JSON.parse(txt); } catch (e) { return null; } })
          .catch(function () { return null; });
      });
      var promise = Promise.all(jobs).then(function (res) {
        var merged = [];
        res.forEach(function (r) {
          if (r && r.code === 0 && Array.isArray(r.extra)) merged = merged.concat(r.extra);
        });
        function ts(x) { try { return Date.parse(String((x.content || {}).createTime || "").replace(/-/g, "/")) || 0; } catch (e) { return 0; } }
        merged.sort(function (a, b) { return ts(b) - ts(a); });
        return JSON.stringify({ code: 0, message: "SUCCESS", time: Date.now(), extra: merged });
      });
      inflight = { key: key, promise: promise };
      promise.then(function (text) {
        if (inflight && inflight.promise === promise) inflight = null;
        if (cancelled || seq !== batchSeq || mode !== "ALL") return;
        deliver(text);
        cleanUrl();
      });
    }
  }

  window.XMLHttpRequest = HookedXHR;

  onRoute();
  document.addEventListener("DOMContentLoaded", onRoute);
})();
