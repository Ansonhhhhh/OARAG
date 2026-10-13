from flask import Flask,request,jsonify,Response,send_from_directory

import io
import json
import os
import config
import llm
import storage
import rag

app = Flask(__name__,static_folder="static",static_url_path="")

@app.route("/")
def index():
    return send_from_directory("static","index.html")

@app.route("/api/session",methods=['GET'])
def list_session():
    #会话功能
    return jsonify([storage.list_sessions()])

@app.route("/api/sessions",methods=['GET'])
def list_sessions():
    #会话接口
    return jsonify([storage.list_sessions()])

@app.route("/api/sessions", methods=["POST"])
def new_session():
    #创建会话
    data = request.get_json(silent=True) or {}
    title = data.get("title","").strip() or None
    session = storage.create_session(title)
    return jsonify(session)

@app.route("/api/sessions/<session_id>", methods=["GET"])
def get_session(session_id):
    #获取会话(单个)
    s = storage.get_session(session_id)
    if not s:
        return jsonify({"error":"session not found"}),404
    return jsonify(s)

@app.route("/api/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id):
    #删除会话
    ok = storage.delete_session(session_id)
    if not ok:
        return jsonify({"error":"session not found"}),404
    return jsonify({"deleted":True})

@app.route("/api/sessions/<session_id>", methods=["PUT"])
def rename_session(session_id):
    #重命名会话
    data = request.get_json(silent=True) or {}
    title = data.get("title", "").strip()
    if not title:
        return jsonify({"error": "empty title"}), 400
    s = storage.get_session(session_id)
    if not s:
        return jsonify({"error": "session not found"}), 404
    s["title"] = title
    storage.save_session(s)
    return jsonify(s)

@app.route("/api/documents",methods=['GET'])
def list_documents():
    #文档功能
    return jsonify(storage.list_documents())

def _extract_text(filename, data):
    """按扩展名从字节流提取文本；不支持或无法解析时返回 None。"""
    ext = os.path.splitext(filename)[1].lower()
    if ext in (".txt", ".md", ".markdown", ""):
        return data.decode("utf-8", errors="replace")
    if ext == ".docx":
        from docx import Document
        doc = Document(io.BytesIO(data))
        parts = [p.text for p in doc.paragraphs]
        for table in doc.tables:
            for row in table.rows:
                parts.extend(cell.text for cell in row.cells)
        return "\n".join(parts)
    if ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    return None


@app.route("/api/documents/upload", methods=["POST"])
def upload_document():
    if "file" not in request.files:
        return jsonify({"error": "no file"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "no filename"}), 400

    data = f.read()
    try:
        text = _extract_text(f.filename, data)
    except Exception as e:
        return jsonify({"error": f"解析失败：{e}"}), 400

    if text is None:
        return jsonify({"error": "暂不支持该格式，请上传 .txt/.md/.docx/.pdf"}), 400
    if not text.strip():
        return jsonify({"error": "未提取到文本（可能是扫描件或空文档）"}), 400

    count = rag.index_document(f.filename, text)
    return jsonify({"filename": f.filename, "chunk_count": count})


@app.route("/api/documents/<filename>", methods=["DELETE"])
def delete_document(filename):
    storage.remove_document(filename)
    return jsonify({"deleted": filename})

# 聊天接口（SSE流式）

def _build_system_prompt(context_texts):
    if context_texts:
        ctx = "\n---\n".join(context_texts)
        return (
            "你是一个知识库助手。请仅根据以下资料回答用户的问题，"
            "如果资料中没有答案，请如实说'知识库中暂无相关内容'。\n\n"
            f"【参考资料】\n{ctx}"
        )
    return "你是一个知识库助手。知识库当前为空，请告知用户先上传文档。"

def _stream_chat(history_messages, query, top_k=None):
    if top_k is None:
        top_k = config.RETRIEVAL_TOP_K

    # 检索相关文档片段
    retrieved, scores = rag.retrieve(query, top_k=top_k)
    context_texts = [c["text"] for c in retrieved]
    system = _build_system_prompt(context_texts)

    """组装消息并流式调用DeepSeek,以SSE格式yield。"""
    messages = [{"role":"system","content":system}]
    for m in history_messages:
        messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": query})

    try:
        stream = llm.get_client().chat.completions.create(
            model=config.DEEPSEEK_MODEL,
            messages=messages,
            stream=True,
            temperature=0.7,
            max_tokens=2048,
        )

        # 先发检索元信息（含引用来源，供前端展示）
        sources = [
            {
                "filename": c.get("filename", ""),
                "chunk_index": c.get("chunk_index", 0),
                "score": round(float(s), 4),
                "snippet": c.get("text", "")[:80].replace("\n", " "),
            }
            for c, s in zip(retrieved, scores)
        ]
        meta = {"type": "meta", "retrieved_count": len(retrieved), "sources": sources}
        yield f"data: {json.dumps(meta, ensure_ascii=False)}\n\n"

        for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                text = delta.content
                payload = json.dumps({"type": "content", "text": text}, ensure_ascii=False)
                yield f"data: {payload}\n\n"

        yield "data: [DONE]\n\n"

    except Exception as e:
        payload = json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False)
        yield f"data: {payload}\n\n"

@app.route("/api/chat/stream",methods=["POST"])
def chat_stream():
    data = request.get_json(force=True)
    query = data.get("message","").strip()
    session_id = data.get("session_id","").strip()

    if not query:
        return jsonify({"error":"empty message"}), 400
# 没传session_id 或 session 不存在 → 自动创建
    if not session_id:
        s = storage.create_session()
        session_id = s["id"]
    elif not storage.get_session(session_id) :
        s = storage.create_session()
        session_id = s["id"]

    def generate():
        session = storage.get_session(session_id)
        history = session.get("messages",[]) if session else []

        full_answer = ""
        sources = []

        for sse_line in _stream_chat(history,query):
            if sse_line.strip():
                try:
                    raw = sse_line.strip()
                    if raw.startswith("data:"):
                        raw = raw[len("data:"):].strip()
                    if raw and raw != "[DONE]":
                        d = json.loads(raw)
                        if d.get("type") == "content":
                            full_answer += d.get("text","")
                        elif d.get("type") == "meta":
                            sources = d.get("sources", [])
                except Exception:
                    pass
            yield sse_line

        if session:
            session["messages"].append({"role":"user","content":query})
            session["messages"].append({"role":"assistant","content":full_answer,"sources":sources})

            if not session.get("title") or session["title"].startswith("会话"):
                session["title"] = query[:30] + ("..." if len(query)>30 else "")
            storage.save_session(session)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



if __name__ == '__main__':
    app.run(host = "0.0.0.0", port = 8000, debug = True)