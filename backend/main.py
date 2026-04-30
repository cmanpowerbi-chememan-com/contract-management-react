import os
import threading
from datetime import datetime

import numpy as np
import pandas as pd
import pytz
import requests
from deltalake import DeltaTable, write_deltalake
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── OneLake helpers ──────────────────────────────────────────────────────────
_token_cache: dict = {"token": None, "expires_at": 0}
_token_lock = threading.Lock()


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
    try:
        opts = storage_options()
        df = (
            DeltaTable(f"{ONELAKE_BASE}/gold_contract_management", storage_options=opts)
            .to_pandas()
            .drop_duplicates(subset=["purchasing_doc_no"])
            .sort_values("purchasing_doc_no")
        )
        return {"data": _clean(df)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/status")
def get_status():
    try:
        opts = storage_options()
        df = DeltaTable(
            f"{ONELAKE_BASE}/gold_manual_contract_status", storage_options=opts
        ).to_pandas()

        if "updated_timestamp" in df.columns and "update_at" not in df.columns:
            df = df.rename(columns={"updated_timestamp": "update_at"})

        if "update_at" in df.columns:
            df["update_at"] = (
                pd.to_datetime(df["update_at"], utc=True)
                .dt.tz_convert("Asia/Bangkok")
                .dt.tz_localize(None)
                .astype(str)
            )
            df = df.sort_values("update_at", ascending=False)

        df = df.drop_duplicates(subset=["purchasing_doc_no"], keep="first")
        for col in ["comment", "new_purchasing_doc_no"]:
            if col not in df.columns:
                df[col] = ""

        return {"data": df.to_dict(orient="records")}
    except Exception:
        return {"data": []}


class StatusEntry(BaseModel):
    purchasing_doc_no:     str
    purchaser_status:      str
    comment:               str = ""
    new_purchasing_doc_no: str = ""
    user_status:           str = ""


@app.post("/api/status")
def save_status(entry: StatusEntry):
    try:
        opts = storage_options()

        # Load current table
        try:
            df = DeltaTable(
                f"{ONELAKE_BASE}/gold_manual_contract_status", storage_options=opts
            ).to_pandas()
            if "updated_timestamp" in df.columns and "update_at" not in df.columns:
                df = df.rename(columns={"updated_timestamp": "update_at"})
            for col in ["comment", "new_purchasing_doc_no", "update_at"]:
                if col not in df.columns:
                    df[col] = ""
        except Exception:
            df = pd.DataFrame(columns=[
                "purchasing_doc_no", "user_status", "purchaser_status",
                "comment", "new_purchasing_doc_no", "update_at",
            ])

        bkk = pytz.timezone("Asia/Bangkok")
        now_str = datetime.now(bkk).strftime("%Y-%m-%d %H:%M:%S")

        # Remove existing row for this doc, prepend new one
        df = df[df["purchasing_doc_no"] != entry.purchasing_doc_no]
        new_row = pd.DataFrame([{
            "purchasing_doc_no":     entry.purchasing_doc_no,
            "user_status":           entry.user_status,
            "purchaser_status":      entry.purchaser_status,
            "comment":               entry.comment,
            "new_purchasing_doc_no": entry.new_purchasing_doc_no,
            "update_at":             now_str,
        }])
        df = pd.concat([new_row, df], ignore_index=True)

        # Write in background thread
        def _write(df, opts):
            write_deltalake(
                f"{ONELAKE_BASE}/gold_manual_contract_status",
                df, mode="overwrite", schema_mode="overwrite",
                storage_options=opts,
            )

        t = threading.Thread(target=_write, args=(df.copy(), opts), daemon=False)
        t.start()

        return {"ok": True, "update_at": now_str}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
