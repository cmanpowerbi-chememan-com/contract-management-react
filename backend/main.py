import logging
import os
import queue
import threading
from datetime import datetime

import numpy as np
import pandas as pd
import pyarrow as pa
import pytz
import requests
from deltalake import DeltaTable, write_deltalake
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

# ── Config ──────────────────────────────────────────────────────────────────
TENANT_ID     = os.environ["TENANT_ID"]
CLIENT_ID     = os.environ["CLIENT_ID"]
CLIENT_SECRET = os.environ["CLIENT_SECRET"]
WORKSPACE_ID  = "69a84913-d8e5-4ca9-970e-85e3ddc68f14"
LAKEHOUSE_ID  = "961d3727-8929-45b1-835d-95568f2ebe59"

ONELAKE_BASE = (
    f"abfss://{WORKSPACE_ID}@onelake.dfs.fabric.microsoft.com"
    f"/{LAKEHOUSE_ID}/Tables"
)

def _clean(df: pd.DataFrame) -> list:
    """Convert DataFrame to JSON-safe list of dicts (handles NaN, NaT, timestamps)."""
    df = df.copy()
    for col in df.select_dtypes(include=["datetime64[ns]", "datetime64[ns, UTC]"]).columns:
        df[col] = df[col].astype(str)
    df = df.replace({np.nan: None, pd.NaT: None})
    return df.to_dict(orient="records")


PURCHASER_STATUS_OPTIONS = [
    "Not Start",
    "RFQ - Request for Quotation",
    "Compared",
    "RL - Recommend Letter",
    "OA Created",
    "Cancel OA",
    "Completed",
]

# ── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Contract Management API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── OneLake helpers ──────────────────────────────────────────────────────────
_token_cache: dict = {"token": None, "expires_at": 0}
_token_lock = threading.Lock()

_contracts_cache: dict = {"data": None, "expires_at": 0}
_contracts_lock = threading.Lock()

_docnums_cache: dict = {"data": None, "expires_at": 0}
_docnums_lock = threading.Lock()

# In-memory DataFrame of gold_manual_contract_status — shared between GET and POST
# so save never needs to re-read from OneLake. TTL matches _contracts_cache pattern
# so a stale cache (another writer changed the table) self-heals on the next GET.
_status_df: list[dict] | None = None
_status_lock = threading.Lock()
_status_expires_at: float = 0
_STATUS_TTL = 300  # 5 min

# Background write queue — a single worker processes saves strictly in the order
# they were submitted, so two rapid POSTs can never interleave a read-merge-write
# cycle (the later save always wins for the same doc). Each job re-reads the
# CURRENT table from OneLake and replaces only that doc's row — it never dumps
# the whole in-memory cache, so rows another writer (e.g. the email-confirm
# Azure Function) added between reads are preserved.
_write_queue: "queue.Queue" = queue.Queue()
_write_worker_thread: threading.Thread | None = None
_write_worker_start_lock = threading.Lock()


def get_token() -> str:
    import time
    with _token_lock:
        if _token_cache["token"] and time.time() < _token_cache["expires_at"]:
            return _token_cache["token"]
        url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
        res = requests.post(url, data={
            "grant_type":    "client_credentials",
            "client_id":     CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "scope":         "https://storage.azure.com/.default",
        })
        if not res.ok:
            raise HTTPException(status_code=502, detail=f"Token error: {res.text}")
        data = res.json()
        _token_cache["token"] = data["access_token"]
        _token_cache["expires_at"] = time.time() + 3000
        return _token_cache["token"]


def storage_options() -> dict:
    return {
        "bearer_token":        get_token(),
        "use_fabric_endpoint": "true",
    }


# ── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/api/status-options")
def status_options():
    return {"options": PURCHASER_STATUS_OPTIONS}


@app.get("/api/contracts")
def get_contracts():
    import time
    with _contracts_lock:
        if _contracts_cache["data"] is not None and time.time() < _contracts_cache["expires_at"]:
            return {"data": _contracts_cache["data"]}
    try:
        opts = storage_options()
        df = (
            DeltaTable(f"{ONELAKE_BASE}/gold_contract_management", storage_options=opts)
            .to_pandas()
            .drop_duplicates(subset=["purchasing_doc_no"])
            .sort_values("purchasing_doc_no")
        )
        data = _clean(df)
        with _contracts_lock:
            _contracts_cache["data"] = data
            _contracts_cache["expires_at"] = time.time() + 300  # 5 min TTL
        return {"data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/doc-numbers")
def get_doc_numbers():
    import time
    with _docnums_lock:
        if _docnums_cache["data"] is not None and time.time() < _docnums_cache["expires_at"]:
            return {"doc_numbers": _docnums_cache["data"]}
    try:
        opts = storage_options()
        df = DeltaTable(
            f"{ONELAKE_BASE}/silver_sap_tct_header", storage_options=opts
        ).to_pandas()
        nums = (
            df["purchasing_doc_no"]
            .dropna()
            .astype(str)
            .str.strip()
            .drop_duplicates()
            .sort_values()
            .tolist()
        )
        with _docnums_lock:
            _docnums_cache["data"] = nums
            _docnums_cache["expires_at"] = time.time() + 300  # 5 min TTL
        return {"doc_numbers": nums}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _empty_status_df() -> pd.DataFrame:
    return pd.DataFrame(columns=[
        "purchasing_doc_no", "user_status", "purchaser_status",
        "comment", "new_purchasing_doc_no", "update_at",
    ])


def _load_status_df(opts: dict) -> pd.DataFrame:
    """Load gold_manual_contract_status from OneLake and normalise types."""
    try:
        df = DeltaTable(
            f"{ONELAKE_BASE}/gold_manual_contract_status", storage_options=opts
        ).to_pandas()
    except Exception:
        return _empty_status_df()

    if "updated_timestamp" in df.columns and "update_at" not in df.columns:
        df = df.rename(columns={"updated_timestamp": "update_at"})
    for col in ["comment", "new_purchasing_doc_no"]:
        if col not in df.columns:
            df[col] = ""
    if "update_at" not in df.columns:
        df["update_at"] = pd.NaT

    df["update_at"] = pd.to_datetime(df["update_at"])
    df = df.sort_values("update_at", ascending=False, na_position="last")
    df = df.drop_duplicates(subset=["purchasing_doc_no"], keep="first")
    for col in ["purchasing_doc_no", "user_status", "purchaser_status",
                "comment", "new_purchasing_doc_no"]:
        df[col] = df[col].fillna("").astype(str)
    return df


def _df_to_api(df: pd.DataFrame) -> list[dict]:
    """Convert internal DataFrame to JSON-safe list for API response."""
    out = df.copy()
    bkk = pytz.timezone("Asia/Bangkok")
    out["update_at"] = (
        pd.to_datetime(out["update_at"], utc=False)
        .dt.tz_localize("Asia/Bangkok", ambiguous="NaT", nonexistent="NaT")
        .dt.tz_convert("Asia/Bangkok")
        .dt.tz_localize(None)
        .astype(str)
    )
    out["update_at"] = out["update_at"].replace("NaT", "")
    return out.to_dict(orient="records")


def _merge_and_write(doc_no: str, new_row: pd.DataFrame, opts: dict) -> pd.DataFrame:
    """Read-before-write: re-read the CURRENT table from OneLake, drop only the
    row(s) for `doc_no`, append `new_row`, write back. Never overwrites with the
    stale in-memory cache — protects rows any other writer added in between."""
    current = _load_status_df(opts)
    merged = pd.concat(
        [new_row, current[current["purchasing_doc_no"] != doc_no]],
        ignore_index=True,
    )
    merged["update_at"] = pd.to_datetime(merged["update_at"])
    for col in ["purchasing_doc_no", "user_status", "purchaser_status",
                "comment", "new_purchasing_doc_no"]:
        merged[col] = merged[col].fillna("").astype(str)
    write_deltalake(
        f"{ONELAKE_BASE}/gold_manual_contract_status",
        merged, mode="overwrite", schema_mode="overwrite",
        storage_options=opts,
    )
    return merged


def _write_worker() -> None:
    """Single background worker — drains `_write_queue` strictly in FIFO order
    so concurrent saves can never interleave a read-merge-write cycle."""
    global _status_df, _status_expires_at
    import time
    while True:
        job = _write_queue.get()
        try:
            if job is None:  # shutdown sentinel
                return
            doc_no, new_row, opts = job
            try:
                merged = _merge_and_write(doc_no, new_row, opts)
                with _status_lock:
                    _status_df = merged
                    _status_expires_at = time.time() + _STATUS_TTL
            except Exception as ex:
                logging.error("OneLake write failed for %s: %s", doc_no, ex)
        finally:
            _write_queue.task_done()


def _ensure_write_worker() -> None:
    """Lazily start the single background write worker (idempotent)."""
    global _write_worker_thread
    with _write_worker_start_lock:
        if _write_worker_thread is None or not _write_worker_thread.is_alive():
            _write_worker_thread = threading.Thread(target=_write_worker, daemon=True)
            _write_worker_thread.start()


@app.get("/api/status")
def get_status():
    import time
    global _status_df, _status_expires_at
    with _status_lock:
        stale = _status_df is None or time.time() >= _status_expires_at
    if stale:
        opts = storage_options()
        fresh = _load_status_df(opts)
        with _status_lock:
            _status_df = fresh
            _status_expires_at = time.time() + _STATUS_TTL
    with _status_lock:
        df = _status_df.copy()
    return {"data": _df_to_api(df)}


@app.get("/api/status/refresh")
def refresh_status():
    """Force reload from OneLake — called by the Refresh button."""
    import time
    global _status_df, _status_expires_at
    opts = storage_options()
    fresh = _load_status_df(opts)
    with _status_lock:
        _status_df = fresh
        _status_expires_at = time.time() + _STATUS_TTL
        df = _status_df.copy()
    return {"data": _df_to_api(df)}


class StatusEntry(BaseModel):
    purchasing_doc_no:     str
    purchaser_status:      str
    comment:               str = ""
    new_purchasing_doc_no: str = ""
    user_status:           str = ""


@app.post("/api/status")
def save_status(entry: StatusEntry):
    global _status_df
    try:
        opts = storage_options()

        bkk = pytz.timezone("Asia/Bangkok")
        now_naive = datetime.now(bkk).replace(tzinfo=None)  # timestamp_ntz
        now_str   = now_naive.strftime("%Y-%m-%d %H:%M:%S")

        new_row = pd.DataFrame([{
            "purchasing_doc_no":     entry.purchasing_doc_no,
            "user_status":           entry.user_status,
            "purchaser_status":      entry.purchaser_status,
            "comment":               entry.comment,
            "new_purchasing_doc_no": entry.new_purchasing_doc_no,
            "update_at":             now_naive,
        }])
        new_row["update_at"] = pd.to_datetime(new_row["update_at"])
        for col in ["purchasing_doc_no", "user_status", "purchaser_status",
                    "comment", "new_purchasing_doc_no"]:
            new_row[col] = new_row[col].fillna("").astype(str)

        # Update in-memory cache immediately — UI responds at once.
        # No OneLake read here: on cache-miss, start from an empty skeleton
        # (not a synchronous OneLake load) so the request path stays fast.
        # The background worker below re-reads OneLake for real before writing.
        with _status_lock:
            if _status_df is None:
                _status_df = _empty_status_df()
            _status_df = pd.concat(
                [new_row, _status_df[_status_df["purchasing_doc_no"] != entry.purchasing_doc_no]],
                ignore_index=True,
            )
            _status_df["update_at"] = pd.to_datetime(_status_df["update_at"])

        # Queue the OneLake write — a single background worker processes saves
        # in order (read-before-write, merges only this doc's row) so it can
        # never clobber rows another writer added since the cache was loaded.
        _ensure_write_worker()
        _write_queue.put((entry.purchasing_doc_no, new_row.copy(), opts))

        return {"ok": True, "update_at": now_str}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Serve React frontend (production) ────────────────────────────────────────
_static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
