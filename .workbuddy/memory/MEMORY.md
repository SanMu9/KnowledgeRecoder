# 项目长期记忆 - KnowledgeRecoder

## 项目定位
本地「知识点记录平台」桌面应用，技术栈：Electron + React + TypeScript + TailwindCSS + Vite。

## 关键架构决策（2026-10-22 详细设计 v1.0）
- 数据根目录：`<userData>/data/`；分类树 `menu-tree.json`（id/parentId 平铺存储），知识点 `notes/<noteId>/{meta.json, content.md, attachments/}`，软删除移入 `trash/`。
- 附件磁盘文件名用 UUID，原始文件名记录在 meta.json 的 attachments 列表。
- Electron 三进程分层：主进程 services（可单测）→ IPC（invoke + Result<T> 统一返回）→ preload 暴露 window.kr → 渲染进程 Zustand。
- 本地文件经自定义协议 `app-file://` 提供，主进程校验路径必须位于数据根内，防穿越；渲染进程禁用 nodeIntegration，markdown/office 转换产物必须 DOMPurify 消毒。
- 预览方案：md=react-markdown，pdf=pdfjs-dist，docx=mammoth，xlsx=SheetJS，pptx=LibreOffice 检测后降级外置打开，代码=PrismJS；搜索=内存索引+Fuse.js。

## 文档
- `需求.md`：原始需求（保持不动）。
- `需求规格说明书.md`：v1.0 需求详细补充（45 条编号化需求、跟踪矩阵、验收门槛、假设 A1–A8）。
- `详细设计文档.md`：v1.0 详细设计（架构/存储/模块/界面/IPC/安全/测试/发布/里程碑）。
- 文档关系：规格说明书定义 WHAT（业务规则与验收），设计文档定义 HOW（技术实现）。
