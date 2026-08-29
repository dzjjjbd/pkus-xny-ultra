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

  // 背景（详见 小测试/sessionStorage写入机制研究报告.md）：
  // 空屏的根因是 sessionStorage 中 userAgent 缺失时，app.js 模块 68354 的 J()
  // 在 axios 请求拦截器里对 null 调用 .split(" ") 抛异常，导致所有 API 请求静默失败。
  // 站点只有在登录页 Login 组件 mounted() 时才补写 userAgent，且只写一次、永不补写。
  //
  // 最小修复：只要在 app.js 执行前把缺失的键补上，请求链路即可恢复正常。
  // 服务器只认 token cookie（30 天），不校验 X-Custom-Auth 头里的 userId，
  // 因此不需要伪造 userInfo/course_userInfo/isout 也能正常加载课程数据。
  // （AI 错题页等读 course_userInfo 的功能在存储被清空的标签页里仍可能报错，
  //   属于“镜像回灌/静默重登”完整方案的范畴，不在本最小修复内。）

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
  } catch (e) {
    // 存储不可用（如隐私模式被禁）时静默跳过，不阻塞页面
  }
})();
