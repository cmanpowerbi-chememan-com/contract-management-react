"""
Regression + concurrency tests for POST /api/status background writes.

Incident (2026-07-22): a web save overwrote gold_manual_contract_status from a
stale in-memory cache and deleted 2 rows the email-confirm Azure Function had
just written directly to the same Delta table. Root cause: the background
write dumped the ENTIRE cached DataFrame with mode="overwrite" instead of
merging only the row that was actually saved.

All tests run against a local filesystem Delta table (see conftest.table_path)
— no network / OneLake call is made (main.storage_options is monkeypatched to
return {} and main.ONELAKE_BASE points at a tmp_path).
"""
import time

import pandas as pd


def _row(doc_no, user_status="", purchaser_status="Not Start", comment="",
         new_doc="", update_at="2026-07-01 10:00:00"):
    return {
        "purchasing_doc_no": doc_no,
        "user_status": user_status,
        "purchaser_status": purchaser_status,
        "comment": comment,
        "new_purchasing_doc_no": new_doc,
        "update_at": update_at,
    }


# ── (a) REGRESSION — the 2026-07-22 incident ────────────────────────────────
def test_regression_external_write_survives_web_save(
    table_path, client, write_table, read_table, wait_for_writes,
):
    """A web save for doc Y must not wipe doc X, which an external writer
    (the email-confirm Azure Function) appended to the table AFTER the
    FastAPI cache was loaded. Pre-fix, this test fails: the background write
    dumps the stale cache (which has no idea doc X exists) with
    mode="overwrite" and doc X disappears."""
    # Seed table, then load the cache the same way the running app would.
    write_table(table_path, [_row("DOC-A", purchaser_status="Completed")])
    resp = client.get("/api/status")
    assert resp.status_code == 200
    assert {r["purchasing_doc_no"] for r in resp.json()["data"]} == {"DOC-A"}

    # External writer appends doc X directly to the table — the cache above
    # has no idea this happened.
    write_table(table_path, [
        _row("DOC-A", purchaser_status="Completed"),
        _row("DOC-X", user_status="ยืนยันแล้ว", purchaser_status="Not Start"),
    ])

    # Web user saves a completely different doc, Y.
    resp = client.post("/api/status", json={
        "purchasing_doc_no": "DOC-Y",
        "purchaser_status": "RFQ - Request for Quotation",
        "comment": "test save",
    })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    wait_for_writes()

    final = read_table(table_path)
    doc_nos = set(final["purchasing_doc_no"])
    assert doc_nos == {"DOC-A", "DOC-X", "DOC-Y"}, (
        "web save must not wipe rows another writer added after the cache loaded"
    )
    x_row = final[final["purchasing_doc_no"] == "DOC-X"].iloc[0]
    assert x_row["user_status"] == "ยืนยันแล้ว"  # untouched by the web save


# ── (b) Double-save ordering ─────────────────────────────────────────────────
def test_double_save_same_doc_last_write_wins(table_path, client, read_table, wait_for_writes):
    r1 = client.post("/api/status", json={
        "purchasing_doc_no": "DOC-Z",
        "purchaser_status": "RFQ - Request for Quotation",
        "comment": "first",
    })
    r2 = client.post("/api/status", json={
        "purchasing_doc_no": "DOC-Z",
        "purchaser_status": "Compared",
        "comment": "second",
    })
    assert r1.status_code == 200 and r2.status_code == 200

    wait_for_writes()

    final = read_table(table_path)
    rows = final[final["purchasing_doc_no"] == "DOC-Z"]
    assert len(rows) == 1, "exactly one row must remain for the doc"
    assert rows.iloc[0]["purchaser_status"] == "Compared"
    assert rows.iloc[0]["comment"] == "second"


def test_double_save_different_docs_both_survive(table_path, client, read_table, wait_for_writes):
    r1 = client.post("/api/status", json={"purchasing_doc_no": "DOC-M", "purchaser_status": "Not Start"})
    r2 = client.post("/api/status", json={"purchasing_doc_no": "DOC-N", "purchaser_status": "Not Start"})
    assert r1.status_code == 200 and r2.status_code == 200

    wait_for_writes()

    final = read_table(table_path)
    assert {"DOC-M", "DOC-N"}.issubset(set(final["purchasing_doc_no"]))


# ── (c) user_status preservation ────────────────────────────────────────────
def test_user_status_preserved_on_purchaser_save(
    table_path, client, write_table, read_table, wait_for_writes,
):
    write_table(table_path, [_row("DOC-P", user_status="ต่อสัญญา", purchaser_status="Not Start")])
    client.get("/api/status")  # load cache, matching normal app flow

    resp = client.post("/api/status", json={
        "purchasing_doc_no": "DOC-P",
        "purchaser_status": "OA Created",
        "comment": "moving forward",
        "user_status": "ต่อสัญญา",  # frontend re-sends the existing value, never blank
    })
    assert resp.status_code == 200

    wait_for_writes()

    final = read_table(table_path)
    row = final[final["purchasing_doc_no"] == "DOC-P"].iloc[0]
    assert row["user_status"] == "ต่อสัญญา"
    assert row["purchaser_status"] == "OA Created"


# ── (d) dtype / schema rules ─────────────────────────────────────────────────
def test_written_row_dtypes(table_path, client, read_table, wait_for_writes):
    resp = client.post("/api/status", json={"purchasing_doc_no": "DOC-Q", "purchaser_status": "Not Start"})
    assert resp.status_code == 200
    wait_for_writes()

    final = read_table(table_path)
    # timestamp_ntz: must be a datetime dtype with NO timezone attached (the
    # exact unit — us vs ns — depends on the installed pyarrow/deltalake
    # version and is not the contract we care about here).
    assert pd.api.types.is_datetime64_any_dtype(final["update_at"])
    assert final["update_at"].dt.tz is None
    for col in ["purchasing_doc_no", "user_status", "purchaser_status",
                "comment", "new_purchasing_doc_no"]:
        assert final[col].isna().sum() == 0


# ── (e) TTL self-heal ─────────────────────────────────────────────────────────
def test_status_cache_ttl_refreshes_stale_data(table_path, client, write_table):
    import main

    write_table(table_path, [_row("DOC-R", purchaser_status="Not Start")])
    resp = client.get("/api/status")
    assert {r["purchasing_doc_no"] for r in resp.json()["data"]} == {"DOC-R"}

    # Force the cache to look stale without waiting the full 5-minute TTL.
    main._status_expires_at = time.time() - 1

    # External writer adds a row the FastAPI process never saw.
    write_table(table_path, [
        _row("DOC-R", purchaser_status="Not Start"),
        _row("DOC-S", purchaser_status="Completed"),
    ])

    resp2 = client.get("/api/status")
    doc_nos = {r["purchasing_doc_no"] for r in resp2.json()["data"]}
    assert doc_nos == {"DOC-R", "DOC-S"}, "stale cache should self-heal via TTL on next GET"
