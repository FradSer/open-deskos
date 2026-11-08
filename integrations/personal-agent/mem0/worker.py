"""Private stdio transport for the Mem0 OSS SDK."""

import logging
import os
import sqlite3
from functools import partial, wraps
from pathlib import Path
from typing import Any

from anyio import Lock, to_thread
from mcp.server.fastmcp import FastMCP
from portalocker import Lock as ProcessLock

state_dir = Path.cwd()
os.umask(0o077)
os.environ["MEM0_DIR"] = str(state_dir)
os.environ["MEM0_TELEMETRY"] = "false"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["FASTEMBED_CACHE_PATH"] = str(state_dir / "embedding-cache")
logging.disable(logging.CRITICAL)

from mem0 import Memory
from mem0.utils.spacy_models import get_nlp_full, get_nlp_lemma

server = FastMCP("Open DeskOS Mem0")
memory: Memory | None = None
receipts = sqlite3.connect(state_dir / "imports.sqlite", check_same_thread=False)
receipts.execute(
    "CREATE TABLE IF NOT EXISTS imports "
    "(owner TEXT, scope TEXT, source TEXT, PRIMARY KEY (owner, scope, source))"
)
write_lock = Lock()


def tool(function: Any, *, writable: bool = False) -> Any:
    @wraps(function)
    async def invoke(*args: Any, **kwargs: Any) -> Any:
        call = partial(function, *args, **kwargs)
        if writable:
            # Cancellation can remove a queued operation before it acquires the lock.
            async with write_lock:
                return await to_thread.run_sync(call)
        return await to_thread.run_sync(call)

    return server.tool()(invoke)


def mutation(function: Any) -> Any:
    return tool(function, writable=True)


def backend() -> Memory:
    if memory is None:
        raise RuntimeError("Mem0 is not configured")
    return memory


@mutation
def configure(config: dict[str, Any]) -> dict[str, bool]:
    global memory
    if memory is not None:
        raise RuntimeError("Mem0 is already configured")
    if set(config) != {"llm", "embedder", "vector_store"}:
        raise ValueError("Select explicit Mem0 providers")
    for field in ("llm", "embedder"):
        provider = config[field]
        if not provider["provider"] or not provider["config"].get("model"):
            raise ValueError("Select an explicit memory model")
        if provider["provider"] == "openai" and (
            not provider["config"].get("openai_base_url") or not provider["config"].get("api_key")
        ):
            raise ValueError("Set the model endpoint and credential explicitly")
    vector_store = config["vector_store"]
    if vector_store["provider"] != "qdrant":
        raise ValueError("Use a Qdrant store")
    store = vector_store["config"]
    if not store.get("url") and bool(store.get("host")) != bool(store.get("port")):
        raise ValueError("Specify both Qdrant host and port")
    if not store.get("url") and not store.get("host"):
        store["path"] = str(state_dir / "vectors")
    config["history_db_path"] = str(state_dir / "history.sqlite")
    candidate = Memory.from_config(config)
    if not candidate.vector_store._has_bm25_slot or candidate.vector_store._get_bm25_encoder() is None:
        raise RuntimeError("Mem0 keyword search is unavailable")
    if get_nlp_full() is None or get_nlp_lemma() is None:
        raise RuntimeError("Mem0 entity recognition is unavailable")
    memory = candidate
    return {"ready": True}


@tool
def list_memories(filters: dict[str, Any], limit: int) -> dict[str, Any]:
    return backend().get_all(filters=filters, top_k=limit)


@tool
def search_memories(query: str, filters: dict[str, Any], limit: int) -> dict[str, Any]:
    return backend().search(query=query, filters=filters, top_k=limit)


def by_key(scope: dict[str, str], key: str) -> list[dict[str, Any]]:
    return backend().get_all(
        filters={**scope, "odk_key": key}, top_k=513
    )["results"]


def in_scope(item: dict[str, Any] | None, scope: dict[str, str]) -> bool:
    return item is not None and all(item.get(k) == v for k, v in scope.items())


@mutation
def put(
    scope: dict[str, str], key: str, text: str, metadata: dict[str, Any], replace: bool = True
) -> dict[str, Any]:
    sdk = backend()
    matches = by_key(scope, key)
    if len(matches) > 1:
        raise RuntimeError("Mem0 record identity is ambiguous")
    if matches:
        item = matches[0]
        if replace and (
            item["memory"] != text
            or any(item["metadata"].get(k) != v for k, v in metadata.items())
        ):
            sdk.update(item["id"], data=text, metadata={**metadata, "odk_key": key})
        return {"created": False, "id": item["id"]}
    added = sdk.add(
        [{"role": "user", "content": text}],
        **scope,
        metadata={**metadata, "odk_key": key},
        infer=False,
    )["results"]
    if len(added) != 1:
        raise RuntimeError("Mem0 did not store the requested record")
    return {"created": True, "id": added[0]["id"]}


@mutation
def remove(scope: dict[str, str], key: str) -> dict[str, int]:
    matches = by_key(scope, key)
    for item in matches:
        backend().delete(item["id"])
    return {"removed": len(matches)}


@mutation
def update_metadata(
    scope: dict[str, str], memory_id: str, metadata: dict[str, Any]
) -> dict[str, bool]:
    sdk = backend()
    if not in_scope(sdk.get(memory_id), scope):
        raise ValueError("Mem0 record is outside the requested scope")
    sdk.update(memory_id, metadata=metadata)
    return {"updated": True}


@mutation
def ingest(
    scope: dict[str, str],
    key: str,
    messages: list[dict[str, str]],
    metadata: dict[str, Any],
    prompt: str,
) -> dict[str, Any]:
    identity = (scope["user_id"], scope["agent_id"], key)
    if receipts.execute(
        "SELECT 1 FROM imports WHERE owner = ? AND scope = ? AND source = ?", identity
    ).fetchone():
        return {"results": []}
    sdk = backend()
    try:
        result = {"results": []}
        if not by_key(scope, key):
            result = sdk.add(
                messages, **scope, metadata={**metadata, "odk_key": key},
                prompt=prompt, infer=True,
            )
    except Exception:
        # A failed native add can already have written some of this source.
        for item in by_key(scope, key):
            sdk.delete(item["id"])
        raise
    with receipts:
        receipts.execute("INSERT INTO imports VALUES (?, ?, ?)", identity)
    return result

if __name__ == "__main__":
    with ProcessLock(state_dir / "worker.lock", timeout=0):
        server.run(transport="stdio")
