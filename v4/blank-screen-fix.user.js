// ==UserScript==
// @name         新能源课程系统-空屏最小修复
// @namespace    pkus-xny-ultra
// @version      0.1.0
// @description  在页面脚本执行前补种 sessionStorage 缺失的 userAgent/source/isuni，修复“掉登录后空屏、刷新无数据”问题
// @match        https://bdfz.xnykcxt.com:5002/stu/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // 原理：网站只在登录页写入 userAgent 等 sessionStorage 键，且永不补写。
  // 这些键一旦丢失（新开标签页等），app.js 的请求拦截器会对 null 调 .split() 崩溃，
  // 所有 API 静默失败，页面空屏。本脚本在页面脚本执行前（document-start）补种缺失键即可恢复。
  // 服务器只认 token cookie，不校验自定义请求头内容，故无需伪造 userInfo 等其余键。

  try {
    if (!sessionStorage.getItem("userAgent")) {
      sessionStorage.setItem("userAgent", navigator.userAgent);
    }
    if (!sessionStorage.getItem("source")) {
      sessionStorage.setItem("source", "pc");
    }
    if (!sessionStorage.getItem("isuni")) {
      sessionStorage.setItem("isuni", "0");
    }
  } catch (e) {}
})();
