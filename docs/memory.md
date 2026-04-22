# Memory system

The memory subsystem supports **RAG** (retrieval-augmented generation): embed text via the **Gemini Embedding API**, store and retrieve vectors in a **Hugging Face Storage Bucket** (S3-compatible object storage), and inject retrieved passages into the agent's system prompt each cycle.

When `features.memory_enabled` is `false` in `config.toml`, the app skips RAG, sync, and writes (API keys may remain in `.env`). Restart after turning memory back on if you booted with it off so a real `MemoryStore` is constructed.

## Layers

| Module | File (intended) | Role |
|--------|-----------------|------|
| **Embedder** | `embedder.ts` | Text → dense vectors via Gemini Embedding API. |
| **Store** | `store.ts` | Read/write serialised vector index to HF Storage Bucket. |
| **Bucket helpers** | `hf.ts` | HF bucket authentication, upload, download, and object management. |

## Embedding model

- **API:** Gemini Embedding API — e.g. `text-embedding-004` (768 dimensions).
- **Cloud-backed:** Calls made to the Gemini API at embed-time; no local model weights downloaded.
- **Key:** `GEMINI_API_KEY` (see [Configuration](configuration.md)).
- **Configurable:** Model name stored in `config.toml` under `[gemini]` so it can be updated without touching `.env`.

## Vector store — Hugging Face Storage Buckets

Vectors and their associated text are stored in a **Hugging Face Storage Bucket** (S3-compatible API). The index is serialised (e.g. as Arrow/Parquet or a JSON-lines file with vectors) and uploaded after each write.

Benefits over a local-only store:
- Persistent across machines and restarts without manual sync.
- Access-controlled via `HF_TOKEN`.
- No large binary files in the git tree.

```
HF Storage Bucket
└── botytrader-memory/
    ├── index.arrow     ← serialised vector index + text
    └── meta.json       ← schema version, last updated
```

The exact serialisation format is implementation-defined; the key requirement is that `store.ts` can roundtrip vectors and original text through the bucket.

## Lifecycle

### Store (after each cycle)

1. Take text (e.g. cycle summary, decision rationale + reasoning field).
2. **Embed** → call Gemini Embedding API → dense vector.
3. Append vector + metadata + original text to the in-memory index.
4. **Upload** updated index to HF Storage Bucket via `hf.ts`.

### Retrieve (for RAG — cycle start)

1. **Download** latest index from HF Storage Bucket (or use in-memory cache if fresh enough).
2. **Embed** the current query context (watchlist, session summary, etc.) via Gemini API.
3. **Similarity search** — cosine or dot-product over index vectors → top-k results.
4. **Inject** retrieved text into the LLM system prompt (RAG block).

### Cache strategy

Downloading the full index on every cycle is expensive. A sensible approach:

- Keep the index in memory for the process lifetime.
- Re-download only on startup or when a remote write is detected (e.g. ETag check).
- Upload after every write (write-through), or batch on a schedule to reduce API calls.

## Security notes

- **`HF_TOKEN`** grants read/write access to the storage bucket — keep in `.env`, never commit.
- **`GEMINI_API_KEY`** authorises embedding calls — treat the same as any API key.
- **`huggingface.bucket_name`** in `config.toml` is the only bucket reference; it is not a secret and is safe to commit.
- Memory text may contain **strategy details or portfolio state**; restrict bucket visibility and rotate tokens if leaked.
- No vector data is stored locally in the repo (no `memory/` directory to gitignore).

## Related docs

- [Architecture](architecture.md) — where memory sits in the stack.
- [Agent cycle](agent-cycle.md) — when RAG runs vs when `summarize_to_memory` runs.
- [Configuration](configuration.md) — `GEMINI_API_KEY`, `HF_TOKEN` (secrets); `gemini.embedding_model`, `huggingface.bucket_name` (config.toml).
