import pickle
import os
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from config import CHUNK_SIZE, CHUNK_OVERLAP, RETRIEVAL_TOP_K, DATA_DIR
import storage

VECTORIZER_PATH = os.path.join(DATA_DIR, "vectorizer.pkl")

_vectorizer = None

def get_vectorizer():
    global _vectorizer
    if _vectorizer is not None:
        return _vectorizer
    if os.path.exists(VECTORIZER_PATH):
        with open(VECTORIZER_PATH,"rb") as f:
            _vectorizer = pickle.load(f)
    else:
        _vectorizer = TfidfVectorizer(
            analyzer="char_wb", 
            ngram_range=(2, 4), 
            max_features=10000
        )
    return _vectorizer

def split_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    """滑动窗口分块：每 chunk_size 字符一个块，相邻块重叠 overlap 字符"""
    text = text.strip()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        start = end - overlap
        if start >= len(text):
            break
    return chunks

def index_document(filename, content):
    chunks_texts = split_text(content)
    if not chunks_texts:
        return 0
    storage.add_document(filename, chunks_texts)
    rebuild_vectorizer()
    return len(chunks_texts)

def rebuild_vectorizer():
    """在全量 chunk 上重新训练向量器"""
    global _vectorizer
    all_chunks = storage.get_all_chunks()
    texts = [c["text"] for c in all_chunks]
    _vectorizer = TfidfVectorizer(
        analyzer="char_wb", ngram_range=(2, 4), max_features=10000
    )
    _vectorizer.fit(texts)
    with open(VECTORIZER_PATH, "wb") as f:
        pickle.dump(_vectorizer, f)
    return _vectorizer


def retrieve(query, top_k=RETRIEVAL_TOP_K):
    """将查询转为 TF-IDF 向量，与所有 chunk 算余弦相似度，返回 top_k"""
    all_chunks = storage.get_all_chunks()
    if not all_chunks:
        return [], []

    vec = get_vectorizer()
    texts = [c["text"] for c in all_chunks]
    chunk_matrix = vec.transform(texts)   # 稀疏矩阵 (n_chunks × vocab)
    query_vec = vec.transform([query])    # 稀疏矩阵 (1 × vocab)

    # 余弦相似度（TF-IDF 向量已 L2 归一化，直接点积即可）
    sims = cosine_similarity(query_vec, chunk_matrix)[0]

    ranked = sorted(
        zip(all_chunks, sims),
        key=lambda x: x[1],
        reverse=True,
    )
    top = ranked[:top_k]

    retrieved_chunks = []
    retrieved_scores = []
    for chunk, score in top:
        retrieved_chunks.append(chunk)
        retrieved_scores.append(float(score))

    return retrieved_chunks, retrieved_scores