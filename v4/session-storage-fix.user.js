// ==UserScript==
// @name         新能源课程系统-SessionStorage修复
// @namespace    pkus-xny-ultra
// @version      0.2.0
// @description  在页面脚本执行前补种 sessionStorage 缺失的 userAgent/source/isuni，并用 localStorage 镜像回灌 course_userInfo，修复“存储丢失”导致的三类问题：页面空屏、收藏页转圈、判分/错因无响应
// @match        https://bdfz.xnykcxt.com:5002/stu/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  var USER_INFO_KEY = "course_userInfo";
  var MIRROR_KEY = "xny-mirror:course_userInfo";

  // 原理：网站在登录时一次性写入 sessionStorage 的 course_userInfo / userAgent 等键，
  // 之后永不补写。这些键一旦丢失（新开标签页、浏览器重启、手动清理等），会引发三类问题：
  //   1) 空屏：请求拦截器对缺失的 userAgent 调 .split() 崩溃，所有 API 静默失败；
  //   2) 收藏页转圈：GetErrorContent 对缺失的 course_userInfo 取 .userId 抛 TypeError，
  //      回调中断，加载圈永远不消失；
  //   3) 判分/错因无响应：SetORData / ErrorMenuClick / Readover 等取 .userId/.userName
  //      抛 TypeError，提交判分、标错因静默失败。
  // 本脚本在页面脚本执行前（document-start）补种这些键：userAgent/source/isuni 直接补齐，
  // course_userInfo 用 localStorage 镜像（登录写入时实时同步，缺失时回灌）。
  // 服务器只认 token cookie，不校验客户端这些键，故补种即可恢复。

  try {
    // 一、补种空屏相关键
    if (!sessionStorage.getItem("userAgent")) {
      sessionStorage.setItem("userAgent", navigator.userAgent);
    }
    if (!sessionStorage.getItem("source")) {
      sessionStorage.setItem("source", "pc");
    }
    if (!sessionStorage.getItem("isuni")) {
      sessionStorage.setItem("isuni", "0");
    }

    // 二、course_userInfo 镜像 / 回灌
    var current = sessionStorage.getItem(USER_INFO_KEY);
    if (current) {
      // 已有则刷新镜像
      try {
        localStorage.setItem(MIRROR_KEY, current);
      } catch (e) {}
    } else {
      // 缺失则从镜像回灌
      var mirror = null;
      try {
        mirror = localStorage.getItem(MIRROR_KEY);
      } catch (e) {}
      if (mirror) {
        sessionStorage.setItem(USER_INFO_KEY, mirror);
      }
    }
  } catch (e) {}

  // 三、实时镜像：包装 Storage.prototype.setItem，捕获登录成功瞬间的写入
  // （避免“装插件后首次登录、同会话内开新标签”时镜像为空）
  try {
    var proto = Storage.prototype;
    var origSet = proto.setItem;
    proto.setItem = function (key, value) {
      origSet.call(this, key, value);
      if (this === sessionStorage && key === USER_INFO_KEY) {
        try {
          origSet.call(localStorage, MIRROR_KEY, value);
        } catch (e) {}
      }
    };
  } catch (e) {}
})();
