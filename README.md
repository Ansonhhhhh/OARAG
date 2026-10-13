# OARAG · 轻量级 RAG 知识库问答系统

一个不依赖数据库和深度学习框架的 **RAG（检索增强生成）** 知识库问答机器人：上传文档 → 自动建立本地索引 → 基于文档内容流式问答，并在回答下方给出**引用来源**。

技术栈刻意保持轻量（Flask + scikit-learn + 原生前端），目的是把 RAG 的完整链路**看得见、改得动**。

## 功能

- 📄 **文档入库**：支持 `.txt` / `.md` / `.docx` / `.pdf`，按扩展名提取文本 → 滑动窗口分块 → 本地检索
- 💬 **多会话管理**：新建 / 切换 / 重命名 / 删除，历史消息持久化到本地 JSON
- ⚡ **SSE 流式输出**：大模型回答逐字返回，前端 fetch + ReadableStream 实时渲染
- 🔍 **引用来源**：每条回答附带检索到的文档片段（文件名 · 第 N 块 · 相似度），可随会话持久化
- 🧩 **零外部依赖**：不用数据库、不用 Docker、不用向量库，纯 Python + 文件存储

## 技术栈

| 技术 | 作用 |
|---|---|
| Flask | Web 框架，REST API + SSE 流式响应 + 静态托管 |
| scikit-learn | TF-IDF 文本向量化与余弦相似度检索 |
| DeepSeek API | 大模型对话生成（OpenAI 兼容协议） |
| python-docx / pypdf | 解析 .docx / .pdf 文档正文 |
| 原生 HTML / CSS / JS | 前端页面与交互，Fetch API 读取 SSE |

## RAG 流程

```
上传文档 → 按扩展名提取文本 → 滑动窗口分块(chunk_size=400, overlap=100)
        → TF-IDF 向量化(char_wb, 2-4gram)
用户提问 → 向量化 → 与所有 chunk 算余弦相似度 → 取 Top-K 片段
        → 拼进 System Prompt → DeepSeek 生成 → SSE 流式返回
```

检索到的片段会作为「引用来源」一并返回前端展示；模型被约束为**仅根据资料回答**，资料中没有则如实说明。

## 快速开始

```bash
# 1. 创建虚拟环境
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

# 2. 安装依赖
pip install -r requirements.txt

# 3. 配置 API Key（复制模板后填入真实 Key）
copy .env.example .env          # Windows
# cp .env.example .env          # macOS / Linux

# 4. 启动
python app.py
```

浏览器打开 <http://localhost:8000>，在左侧「知识库」上传文档，然后即可提问。

## 目录结构

```
RAG/
├── app.py              # Flask 入口：全部 API + SSE 流式聊天
├── config.py           # 配置读取（.env）
├── llm.py              # DeepSeek 客户端封装（流式）
├── rag.py              # 分块 / TF-IDF 向量化 / 检索
├── storage.py          # JSON 文件存储（会话 + 文档索引）
├── chat.py             # 命令行对话脚本（验证用）
├── requirements.txt
├── static/
│   ├── index.html      # 单页前端结构
│   ├── css/style.css   # 样式
│   └── js/app.js       # 前端交互逻辑
└── data/               # 运行时数据（自动创建，不入库）
```

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sessions` | 会话列表 |
| POST | `/api/sessions` | 新建会话 |
| GET | `/api/sessions/<id>` | 获取单个会话（含消息） |
| PUT | `/api/sessions/<id>` | 重命名会话 |
| DELETE | `/api/sessions/<id>` | 删除会话 |
| GET | `/api/documents` | 已入库文档列表 |
| POST | `/api/documents/upload` | 上传文档（multipart） |
| DELETE | `/api/documents/<filename>` | 删除文档及其索引 |
| POST | `/api/chat/stream` | 流式聊天（SSE） |

## 效果截图

> 待补：`docs/screenshot.png`

## 说明

- 本项目的向量检索基于 **TF-IDF**（稀疏的字/词频向量），用于理解 RAG 机理；若需语义检索，可替换为 embedding 模型 + 向量库。
- 首次上传文档时会训练向量器并保存到 `data/vectorizer.pkl`；chunk 只存文本，检索时现算向量（避免索引文件膨胀）。
