"""AI 비서 골든 파일 생성 — ClientMemory 원본(.tmp/ai-run/ClientMemory/app)의 규칙 모듈만 실행해 결과를 저장한다.

- 서버·브라우저·알림·외부 전송 없음: 모듈을 import해 함수만 부른다(HTTP 서버 시작 없음, 알림 스레드 없음).
- 현재 시각은 CM_FAKE_NOW(기본 2026-10-30 10:00)로 고정한다.
- 데이터 폴더(CM_DATA_DIR)는 임시 폴더에 만들고 끝나면 지운다. 바이트코드(.pyc)를 만들지 않아 원본 폴더에 파일을 남기지 않는다.
- 쓰기: itda/tests/fixtures/assistant-golden.json (이 파일만)

실행: py -3 itda/tools/gen-assistant-golden.py
"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ITDA = os.path.dirname(HERE)
ROOT = os.path.dirname(ITDA)
SRC = os.path.join(ROOT, ".tmp", "ai-run", "ClientMemory", "app")
OUT = os.path.join(ITDA, "tests", "fixtures", "assistant-golden.json")

# 환경은 import 전에 정해야 한다(db.py가 import 시점에 읽는다)
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True
os.environ.setdefault("CM_FAKE_NOW", "2026-10-30 10:00")
TMP = tempfile.mkdtemp(prefix="cm-golden-")
os.environ["CM_DATA_DIR"] = TMP
sys.path.insert(0, SRC)

import datetime as dt  # noqa: E402

import db  # noqa: E402
import seed  # noqa: E402
import ai_sample  # noqa: E402
import briefing  # noqa: E402
import followup  # noqa: E402
import nlsearch  # noqa: E402
import notify  # noqa: E402
import server  # noqa: E402  (함수만 부른다. main()은 실행하지 않는다)

FAKE_NOW = os.environ["CM_FAKE_NOW"]

SEARCHES = [
    # README 예시 6개(결과가 TS와 같아야 한다)
    "골프 좋아하는 은행 담당자 찾아줘",
    "최근 3개월 동안 만나지 못한 고객은?",
    "다음 달 생일인 고객 알려줘",
    "CMS 운영시간 확대에 관심을 보인 고객은?",
    "지난번에 자료를 요청했던 고객은 누구야?",
    "아직 처리하지 못한 요청사항을 모두 보여줘",
    # 그 밖에 같아야 하는 질문
    "이번 달 생일인 고객",
    "이번 주 생일인 고객",
    "12월에 생일인 사람",
    "한 달 넘게 연락 못 한 분",
    "기한이 지난 요청사항 보여줘",
    "기한 임박한 요청사항",
    "협력사 담당자 찾아줘",
    "정부기관 고객",
    "증권 담당자",
    "해산물을 싫어하는 고객",
    "테니스 관심 있는 고객",
    "한식 좋아하는 사람",
    "새빛학원",
    "수수료",
    # 일부러 바꾼 질문(원본은 못 찾음 — TS가 찾아야 한다)
    "해산물 못 드시는 분",
    "이번 달에 내가 챙겨야 할 사람 누구야",
    # 일부러 바꾼 질문(원본은 「음식」으로 잘못 찾음)
    "매운 음식 싫어하는 분",
]


def rows(cur):
    return [db.row_to_dict(r) for r in cur]


def main():
    db.init_db()
    conn = db.connect()
    seed.load_demo(conn)
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM customers")}
    g = {
        "meta": {
            "fakeNow": FAKE_NOW,
            "source": "ClientMemory v0.4.0 app/ (읽기 전용 실행)",
            "python": sys.version.split()[0],
            "note": "ID는 이름으로 바꿔 저장한다. 날짜는 FAKE_NOW 기준 절대값.",
        },
        "customers": [r["name"] for r in conn.execute("SELECT name FROM customers ORDER BY id")],
    }

    # ---- 브리핑(전 고객)
    g["briefings"] = {}
    for cid, name in names.items():
        b = briefing.build(conn, cid)
        m = b["meeting"]
        g["briefings"][name] = {
            "meeting": {k: m[k] for k in ("date", "time", "title", "type")} if m else None,
            "lines": b["lines"],
            "checks": b["checks"],
            "open_requests": b["open_requests"],
            "read_seconds": b["read_seconds"],
        }
    g["upcomingMeetings"] = [
        {"name": r["name"], "date": r["date"], "time": r["time"], "title": r["title"]}
        for r in briefing.upcoming(conn, 14)
    ]

    # ---- 미팅 후 질문(전 미팅) + 대기 목록
    conf = notify.get_conf(conn)
    g["followupQuestions"] = {}
    for m in rows(conn.execute("SELECT * FROM interactions WHERE type='미팅' ORDER BY id")):
        info = followup.build(conn, m["id"])
        key = f"{names[m['customer_id']]}|{m['date']}|{m['title']}"
        g["followupQuestions"][key] = [
            {
                "id": q["id"], "reason": q["reason"], "text": q["text"],
                "options": [{"value": o["value"], "label": o["label"], "inputs": [i["key"] for i in o["inputs"]]}
                            for o in q["options"]],
            }
            for q in info["questions"]
        ]
    g["followupPending"] = [
        {"name": m["name"], "date": m["date"], "time": m["time"], "title": m["title"], "fire_at": m["fire_at"]}
        for m in followup.pending(conn, conf)
    ]

    # ---- 검색(조건·설명·결과·근거)
    g["searches"] = []
    today = db.today()
    for q in SEARCHES:
        cond = nlsearch.rule_parse(q, today)
        res = nlsearch.execute(conn, cond, today)
        g["searches"].append({
            "q": q,
            "conditions": cond,
            "explain": nlsearch.describe(cond),
            "target": res["target"],
            "count": res["count"],
            "customers": [{"name": c["name"], "evidence": [{"label": e["label"], "text": e["text"]} for e in c["evidence"]]}
                          for c in res["customers"]],
            "requests": [{"name": r["name"], "content": r["content"], "status": r["status"], "due_date": r["due_date"],
                          "d_day": r["d_day"]} for r in res["requests"]],
        })

    # ---- 알림 후보(여러 시각)
    g["notices"] = {}
    for stamp in ("2026-10-30 08:00", "2026-10-30 10:00", "2026-10-30 21:00", "2026-10-31 09:30", "2026-11-02 10:00",
                  "2026-11-10 10:00"):
        now = dt.datetime.strptime(stamp, "%Y-%m-%d %H:%M")
        out = []
        for c in notify.candidates(conn, now):
            out.append({
                "kind": c["kind"], "customer": names[c["customer_id"]], "event_date": c["event_date"],
                "fire_at": c["fire_at"].strftime("%Y-%m-%d %H:%M:%S"),
                "title": c["title"].strip()[:300], "body": c["body"][:500],
            })
        out.sort(key=lambda x: (x["kind"], x["customer"], x["title"], x["event_date"]))
        g["notices"][stamp] = out

    # ---- 대시보드·목록·상세
    d = server.api_dashboard(conn, {})
    g["dashboard"] = {
        "today": d["today"], "total": d["total"], "by_type": d["by_type"], "no_contact_days": d["no_contact_days"],
        "meetings": [{k: m[k] for k in ("name", "date", "time", "title")} for m in d["meetings"]],
        "today_requests": [{k: r[k] for k in ("name", "content", "due_date", "d_day", "status")} for r in d["today_requests"]],
        "soon_requests": [{k: r[k] for k in ("name", "content", "due_date", "d_day", "status")} for r in d["soon_requests"]],
        "events": [{k: e[k] for k in ("name", "kind", "label", "date", "d_day")} for e in d["events"]],
        "no_contact": [{"name": c["name"], "days": c["days"], "last_contact_date": c["last_contact_date"]} for c in d["no_contact"]],
        "recent_changes": [h["field"] for h in d["recent_changes"]],
        "recent_customers": [c["name"] for c in d["recent_customers"]],
        "recommendations": [{k: r[k] for k in ("priority", "name", "text", "reason")} for r in d["recommendations"]],
    }
    g["customerView"] = {}
    for cid, name in names.items():
        det = server.api_customer_detail(conn, {}, cid)
        g["customerView"][name] = {
            "missing": det["missing"],
            "birthday": det["birthday"],
            "anniversaries": [{"kind": a["kind"], "label": a["label"], "next_date": a["next_date"], "d_day": a["d_day"]}
                              for a in det["anniversaries"]],
            "requests": [{"content": r["content"], "status": r["status"], "d_day": r["d_day"]} for r in det["requests"]],
            "interactions": [{"type": i["type"], "date": i["date"], "time": i["time"], "title": i["title"]}
                             for i in det["interactions"]],
        }
    lst = server.api_customer_list(conn, {"query": {}})
    g["customerList"] = [{"name": c["name"], "open_requests": c["open_requests"], "missing": c["missing"]}
                         for c in lst["customers"]]
    g["upcomingEvents366"] = [{"name": e["name"], "kind": e["kind"], "label": e["label"], "date": e["date"],
                               "d_day": e["d_day"]} for e in server.upcoming_events(conn, 366)]

    # ---- 승인 흐름(예시 분석 → 기본 선택 그대로 승인)
    kim = next(i for i, n in names.items() if n == "김도현")
    before = db.row_to_dict(conn.execute("SELECT * FROM customers WHERE id=?", (kim,)).fetchone())
    res = ai_sample.sample_result(today)
    draft = server.save_draft(conn, "sample", kim, ai_sample.SAMPLE_FILE, "", res)
    enriched = server.enrich_draft(conn, draft)
    g["sampleResult"] = {k: res[k] for k in ("title", "interaction_type", "interaction_date", "summary", "speaker_note")}
    g["sampleEnriched"] = [
        {k: it.get(k) for k in ("kind", "field", "value", "content", "due_date", "warnings", "include", "status", "existing",
                                "is_list", "mode", "target_note")}
        for it in enriched["items"]
    ]
    items = [{"idx": it["idx"], "include": True, "mode": it.get("mode")} for it in enriched["items"] if it["include"]]
    server.api_draft_apply(conn, {"json": {"items": items, "interaction": {}}}, draft["id"])
    g["sampleApply"] = capture_after(conn, kim, before, names, max_hist_source="sample")

    # ---- 미팅 후 질문 반영(윤지아의 어제 15:00 미팅)
    yoon = next(i for i, n in names.items() if n == "윤지아")
    meet = rows(conn.execute("SELECT * FROM interactions WHERE customer_id=? AND time='15:00'", (yoon,)))[0]
    before = db.row_to_dict(conn.execute("SELECT * FROM customers WHERE id=?", (yoon,)).fetchone())
    answers = {
        "held": {"value": "yes"},
        "request": {"value": "자료 요청", "content": "관리비 CMS 이용 안내서 전달", "due_date": "2026-11-06", "assignee": "납기팀"},
        "food_ate": {"value": "한식"},
        "food_pref": {"value": "both", "like": "냉면", "dislike": "고수"},
        "interest": {"value": "업무·사업", "text": "관리비 수납 자동화"},
        "next_contact": {"value": "set", "date": "2026-11-12"},
        "personality": {"value": "etc", "text": "차분하고 질문이 구체적"},
    }
    props, info = followup.proposals(conn, meet["id"], answers)
    g["followupProposals"] = {
        "questionIds": [q["id"] for q in info["questions"]],
        "answers": answers,
        "proposals": [{k: p.get(k) for k in ("kind", "field", "label", "old", "new", "mode", "due_date", "assignee")}
                      for p in props],
    }
    req = {"json": {"answers": answers, "items": [{"idx": i, "include": True} for i in range(len(props))]}}
    server.api_followup_apply(conn, req, meet["id"])
    g["followupApply"] = capture_after(conn, yoon, before, names, max_hist_source="followup")
    st = followup.get_state(conn, meet["id"])
    g["followupApply"]["state"] = {"status": st["status"], "answers": json.loads(st["answers_json"]),
                                  "asked": json.loads(st["asked_json"])}

    conn.close()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(g, f, ensure_ascii=False, indent=1, sort_keys=False)
        f.write("\n")
    print("골든 저장:", OUT)
    print("고객", len(g["customers"]), "· 브리핑", len(g["briefings"]), "· 미팅 질문", len(g["followupQuestions"]),
          "· 검색", len(g["searches"]), "· 알림 시각", len(g["notices"]))


def capture_after(conn, cid, before, names, max_hist_source):
    after = db.row_to_dict(conn.execute("SELECT * FROM customers WHERE id=?", (cid,)).fetchone())
    changed = {k: [before[k], after[k]] for k in db.FIELD_KEYS if (before[k] or "") != (after[k] or "")}
    hist = [{"field": h["field"], "old": h["old_value"], "new": h["new_value"], "source": h["source"], "note": h["note"]}
            for h in conn.execute("SELECT * FROM change_history WHERE customer_id=? AND source=? ORDER BY id", (cid, max_hist_source))]
    inters = [{"type": i["type"], "date": i["date"], "time": i["time"], "title": i["title"], "summary": i["summary"],
               "details": i["details"], "source": i["source"]}
              for i in conn.execute("SELECT * FROM interactions WHERE customer_id=? ORDER BY id", (cid,))]
    reqs = [{"content": r["content"], "received_date": r["received_date"], "due_date": r["due_date"], "status": r["status"],
             "assignee": r["assignee"], "source": r["source"], "has_interaction": r["interaction_id"] is not None}
            for r in conn.execute("SELECT * FROM requests WHERE customer_id=? ORDER BY id", (cid,))]
    return {"customer": names[cid], "changed": changed, "history": hist, "interactions": inters, "requests": reqs}


if __name__ == "__main__":
    try:
        main()
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
