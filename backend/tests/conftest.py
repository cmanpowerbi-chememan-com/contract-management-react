import os
import queue
import sys
import threading
import time

import pandas as pd
import pytest
from deltalake import DeltaTable, write_deltalake
from fastapi.testclient import TestClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import main  # noqa: E402  (backend/main.py)

STATUS_COLUMNS = [
    "purchasing_doc_no", "user_status", "purchaser_status",
    "comment", "new_purchasing_doc_no", "update_at",
]


@pytest.fixture()
def table_path(tmp_path, monkeypatch):
    """Point main.py's OneLake base at a local temp folder and stub auth so no
    network/OneLake call is ever made. Also resets shared in-memory state so
    tests never leak into each other (module-level globals persist across
    tests in the same process since main.py is imported once).

    Uses getattr/hasattr defensively so this fixture (and the test files that
    use it) also run unmodified against the PRE-FIX code — that is what lets
    the regression test prove red-before / green-after against the exact
    same assertions."""
    base = str(tmp_path).replace("\\", "/")
    monkeypatch.setattr(main, "ONELAKE_BASE", base)
    monkeypatch.setattr(main, "storage_options", lambda: {})

    main._status_df = None
    if hasattr(main, "_status_expires_at"):
        main._status_expires_at = 0
    write_queue = getattr(main, "_write_queue", None)
    if write_queue is not None:
        while not write_queue.empty():
            try:
                write_queue.get_nowait()
                write_queue.task_done()
            except queue.Empty:
                break

    yield f"{base}/gold_manual_contract_status"

    main._status_df = None
    if hasattr(main, "_status_expires_at"):
        main._status_expires_at = 0


@pytest.fixture()
def client():
    return TestClient(main.app)


@pytest.fixture()
def write_table():
    """Simulate a writer other than the web app (e.g. the email-confirm Azure
    Function) writing gold_manual_contract_status directly, bypassing the
    FastAPI in-memory cache entirely."""
    def _write(table_path: str, rows: list[dict]) -> None:
        df = pd.DataFrame(rows, columns=STATUS_COLUMNS)
        df["update_at"] = pd.to_datetime(df["update_at"])
        for col in ["purchasing_doc_no", "user_status", "purchaser_status",
                    "comment", "new_purchasing_doc_no"]:
            df[col] = df[col].fillna("").astype(str)
        write_deltalake(table_path, df, mode="overwrite", schema_mode="overwrite")
    return _write


@pytest.fixture()
def read_table():
    def _read(table_path: str) -> pd.DataFrame:
        return DeltaTable(table_path).to_pandas()
    return _read


@pytest.fixture()
def wait_for_writes():
    """Block until every background save queued so far has actually been
    written (or raise) — deterministic alternative to sleeping/polling.

    Post-fix: joins the single-worker `_write_queue`.
    Pre-fix fallback (no queue exists yet): joins the raw non-daemon
    per-save `threading.Thread` the old code launched directly — this is
    what lets the regression test run unmodified against the pre-fix code
    for the red-phase proof."""
    def _wait(timeout: float = 10.0) -> None:
        write_queue = getattr(main, "_write_queue", None)
        if write_queue is not None:
            done = threading.Event()

            def _joiner():
                write_queue.join()
                done.set()

            t = threading.Thread(target=_joiner, daemon=True)
            t.start()
            if not done.wait(timeout):
                raise AssertionError("Background write queue did not drain within timeout")
            return

        deadline = time.time() + timeout
        for t in list(threading.enumerate()):
            if t is threading.current_thread() or t.daemon:
                continue
            t.join(timeout=max(0.0, deadline - time.time()))
    return _wait
