"""Synthetic client-survey regressions using real PostgreSQL and authenticated requests.

Fixture responses are test data. They are not responses from an actual client or research findings.
"""

import csv
import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import psycopg
import pytest

from test_postgres_integration import fresh_auth_limiter, pg_client  # noqa: F401


VERSION = "stockcast-client-survey-v1"
ITEM_IDS = [f"{prefix}_{index}" for prefix in ("fs", "rel", "ic", "ppe") for index in range(1, 4)]
CHARACTERISTICS = {
    "functional_suitability", "reliability", "interaction_capability",
    "perceived_performance_efficiency",
}
CSV_COLUMNS = [
    "submission_id", "questionnaire_version", "submitted_at", "business_id", "user_id",
    "participant_role", "data_origin", "characteristic_id", "item_id", "item_text",
    "response_status", "rating",
]


@pytest.fixture()
def survey_client(pg_client):
    from app.auth_repository import AuthRepository
    from app.config import get_settings
    from app.security import Principal, hash_password

    client, business, dsn = pg_client
    client.headers.pop("X-CSRF-Token", None)
    origin = get_settings().cors_origin
    owner = client.get("/api/v1/auth/me").json()["data"]
    actors = {
        "owner": {
            "userId": owner["userId"], "businessId": business, "role": "owner",
            "session": client.cookies["stockcast_session"],
            "csrf": client.cookies["stockcast_csrf"],
        },
    }
    with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row) as conn:
        other = conn.execute(
            "INSERT INTO businesses(name,data_origin) VALUES('Synthetic Survey Other Store','demo') RETURNING id"
        ).fetchone()["id"]
        password_hash = hash_password("synthetic-survey-only-password")
        for key, tenant, role in [
            ("staff", business, "staff"), ("staff2", business, "staff"),
            ("other", str(other), "owner"),
        ]:
            email = f"synthetic.survey.{key}@example.test"
            # No names or emails belong in the item-level CSV contract.
            display_name = "=HYPERLINK(\"synthetic-only\")" if key == "staff" else f"Synthetic {key}"
            row = conn.execute(
                """INSERT INTO users(business_id,email,display_name,role,password_hash)
                   VALUES(%s,%s,%s,%s,%s) RETURNING id""",
                (tenant, email, display_name, role, password_hash),
            ).fetchone()
            session, csrf, _ = AuthRepository(conn).issue_session(
                Principal(str(row["id"]), tenant, email, display_name, role), 12,
            )
            actors[key] = {
                "userId": str(row["id"]), "businessId": tenant, "role": role,
                "session": session, "csrf": csrf,
            }
    for actor in actors.values():
        actor["readHeaders"] = {
            "Cookie": f"stockcast_session={actor['session']}; stockcast_csrf={actor['csrf']}",
        }
        actor["writeHeaders"] = {
            **actor["readHeaders"], "X-CSRF-Token": actor["csrf"], "Origin": origin,
        }
    return client, business, dsn, actors


def survey_base(business):
    return f"/api/v1/businesses/{business}/survey"


def payload(*, ratings=None, not_applicable=(), submission_id=None):
    ratings = ratings or {}
    return {
        "questionnaireVersion": VERSION,
        "submissionId": submission_id or str(uuid4()),
        "answers": [
            {
                "itemId": item,
                "rating": ratings.get(item),
                "responseStatus": "rated" if item in ratings else
                    "not_applicable" if item in not_applicable else "unanswered",
            }
            for item in ITEM_IDS
        ],
    }


def submit(client, business, actor, body):
    return client.post(survey_base(business) + "/submissions", json=body, headers=actor["writeHeaders"])


def read(client, business, actor, endpoint):
    response = client.get(survey_base(business) + endpoint, headers=actor["readHeaders"])
    assert "X-CSRF-Token" not in response.request.headers
    assert "Origin" not in response.request.headers
    assert response.status_code == 200, response.text
    return response.json()["data"]


def assert_mean(actual, expected):
    if expected is None:
        assert actual is None
    else:
        assert actual == pytest.approx(expected)


def test_published_questionnaire_contains_only_four_client_characteristics(survey_client):
    client, business, _dsn, actors = survey_client
    published = read(client, business, actors["owner"], "/questionnaire")
    canonical = json.loads((Path(__file__).parents[1] / "app/client_survey_v1.json").read_text(encoding="utf-8"))
    assert published == canonical
    assert published["version"] == VERSION
    assert [item["id"] for item in published["items"]] == ITEM_IDS
    assert {item["id"] for item in published["characteristics"]} == CHARACTERISTICS
    assert {item["characteristicId"] for item in published["items"]} == CHARACTERISTICS
    assert [entry["value"] for entry in published["scale"]] == [1, 2, 3, 4, 5]
    assert "technical performance and maintainability require separate engineering evidence" in published["notice"]
    assert read(client, business, actors["staff"], "/questionnaire") == published


def test_empty_summary_has_no_invented_client_findings_or_zero_ratings(survey_client):
    client, business, _dsn, actors = survey_client
    assert read(client, business, actors["owner"], "/submissions") == []
    for key, scope in [("owner", "business"), ("staff", "own")]:
        summary = read(client, business, actors[key], "/summary")
        assert summary["scope"] == scope
        assert summary["participantCount"] == summary["validResponseCount"] == 0
        assert summary["overallWeightedMean"] is None
        assert len(summary["items"]) == 12
        assert len(summary["characteristics"]) == 4
        for item in summary["items"]:
            assert item["validResponseCount"] == item["unansweredCount"] == item["notApplicableCount"] == 0
            assert item["weightedMean"] is None
            assert sum(item["responseCounts"].values()) == 0
        for characteristic in summary["characteristics"]:
            assert characteristic["participantCount"] == characteristic["validResponseCount"] == 0
            assert characteristic["weightedMean"] is None


def test_server_identity_immutable_retry_and_submission_survive_fresh_connection(survey_client):
    client, business, dsn, actors = survey_client
    owner = actors["owner"]
    body = payload(ratings={"fs_1": 5}, not_applicable={"fs_2"})
    before = datetime.now(UTC)
    response = submit(client, business, owner, body)
    assert response.status_code == 201, response.text
    saved = response.json()["data"]
    assert saved["submissionId"] == body["submissionId"]
    assert saved["questionnaireVersion"] == VERSION
    assert saved["businessId"] == business
    assert saved["userId"] == owner["userId"]
    assert saved["participantRole"] == "owner_manager"
    assert saved["dataOrigin"] == "demo"
    submitted_at = datetime.fromisoformat(saved["submittedAt"])
    assert submitted_at.utcoffset() == timedelta(0)
    assert before - timedelta(seconds=5) <= submitted_at <= datetime.now(UTC) + timedelta(seconds=5)
    assert saved["answers"] == body["answers"]

    retry = submit(client, business, owner, {**body, "answers": list(reversed(body["answers"]))})
    assert retry.status_code == 200, retry.text
    assert retry.json()["data"] == saved
    altered = payload(ratings={"fs_1": 1}, submission_id=body["submissionId"])
    assert submit(client, business, owner, altered).status_code == 409
    assert submit(client, business, owner, payload(ratings={"fs_1": 5})).status_code == 409
    assert read(client, business, owner, "/submissions") == [saved]
    for method in ("PATCH", "DELETE"):
        denied = client.request(method, survey_base(business) + "/submissions", json=altered, headers=owner["writeHeaders"])
        assert denied.status_code in (404, 405)

    # Every request is a fresh transaction. Also inspect committed rows from a separate DB connection.
    with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row) as conn:
        committed = conn.execute(
            "SELECT * FROM client_survey_submissions WHERE id=%s", (body["submissionId"],)
        ).fetchone()
        assert str(committed["business_id"]) == business
        assert str(committed["user_id"]) == owner["userId"]
        assert committed["participant_role"] == "owner_manager"
        assert committed["questionnaire_version"] == VERSION
        assert committed["questionnaire_snapshot"]["version"] == VERSION
        assert committed["submitted_at"] == submitted_at
        committed_answers = conn.execute(
            "SELECT item_id,rating,response_status FROM client_survey_answers WHERE submission_id=%s",
            (body["submissionId"],),
        ).fetchall()
        assert len(committed_answers) == 12
        assert next(row for row in committed_answers if row["item_id"] == "fs_1")["rating"] == 5
        assert next(row for row in committed_answers if row["item_id"] == "fs_2")["rating"] is None
    assert read(client, business, owner, "/submissions") == [saved]


def test_business_role_summaries_use_item_denominators_and_exclude_na_unanswered(survey_client):
    client, business, _dsn, actors = survey_client
    bodies = {
        "owner": payload(ratings={"fs_1": 5}, not_applicable={"fs_2"}),
        "staff": payload(ratings={item: 1 for item in ("fs_1", "fs_2", "fs_3", "rel_1")}),
        "staff2": payload(ratings={"rel_1": 4}, not_applicable={"fs_2", "fs_3"}),
    }
    for key, body in bodies.items():
        response = submit(client, business, actors[key], body)
        assert response.status_code == 201, response.text
        assert response.json()["data"]["participantRole"] == ("owner_manager" if key == "owner" else "staff")
    summary = read(client, business, actors["owner"], "/summary")
    assert summary["scope"] == "business"
    assert summary["participantCount"] == 3
    assert summary["validResponseCount"] == 6
    assert_mean(summary["overallWeightedMean"], 13 / 6)
    items = {item["itemId"]: item for item in summary["items"]}
    assert items["fs_1"]["responseCounts"] == {"1": 1, "2": 0, "3": 0, "4": 0, "5": 1}
    assert items["fs_1"]["validResponseCount"] == 2
    assert items["fs_1"]["unansweredCount"] == 1
    assert items["fs_1"]["notApplicableCount"] == 0
    assert_mean(items["fs_1"]["weightedMean"], 3)
    assert items["fs_2"]["validResponseCount"] == 1
    assert items["fs_2"]["notApplicableCount"] == 2
    assert items["fs_2"]["unansweredCount"] == 0
    assert_mean(items["fs_2"]["weightedMean"], 1)
    assert items["fs_3"]["notApplicableCount"] == items["fs_3"]["unansweredCount"] == 1
    assert_mean(items["rel_1"]["weightedMean"], 2.5)
    assert items["rel_1"]["validResponseCount"] == 2
    assert items["rel_1"]["unansweredCount"] == 1
    assert items["ppe_3"]["unansweredCount"] == 3
    assert items["ppe_3"]["weightedMean"] is None
    characteristics = {entry["characteristicId"]: entry for entry in summary["characteristics"]}
    assert characteristics["functional_suitability"]["participantCount"] == 2
    assert characteristics["functional_suitability"]["validResponseCount"] == 4
    assert_mean(characteristics["functional_suitability"]["weightedMean"], 2)
    assert characteristics["reliability"]["participantCount"] == 2
    assert characteristics["reliability"]["validResponseCount"] == 2
    assert_mean(characteristics["reliability"]["weightedMean"], 2.5)
    assert characteristics["interaction_capability"]["participantCount"] == 0
    assert characteristics["interaction_capability"]["weightedMean"] is None
    roles = {entry["participantRole"]: entry for entry in summary["byRole"]}
    assert roles["owner_manager"]["participantCount"] == roles["owner_manager"]["validResponseCount"] == 1
    assert_mean(roles["owner_manager"]["overallWeightedMean"], 5)
    assert roles["staff"]["participantCount"] == 2
    assert roles["staff"]["validResponseCount"] == 5
    assert_mean(roles["staff"]["overallWeightedMean"], 8 / 5)

    own = read(client, business, actors["staff"], "/summary")
    assert own["scope"] == "own"
    assert own["participantCount"] == 1 and own["validResponseCount"] == 4
    assert_mean(own["overallWeightedMean"], 1)
    own_rows = read(client, business, actors["staff"], "/submissions")
    assert len(own_rows) == 1 and own_rows[0]["userId"] == actors["staff"]["userId"]
    forced_scope = read(client, business, actors["staff"], "/summary?scope=business")
    assert forced_scope["scope"] == "own"
    assert forced_scope["participantCount"] == 1
    foreign_summary = read(client, actors["other"]["businessId"], actors["other"], "/summary")
    assert foreign_summary["participantCount"] == foreign_summary["validResponseCount"] == 0
    assert foreign_summary["overallWeightedMean"] is None


def test_owner_item_level_csv_is_authorized_scoped_and_contains_explicit_statuses(survey_client):
    client, business, _dsn, actors = survey_client
    body = payload(ratings={"fs_1": 5}, not_applicable={"fs_2"})
    first = submit(client, business, actors["owner"], body)
    assert first.status_code == 201, first.text
    staff = submit(client, business, actors["staff"], payload(ratings={"rel_1": 2}))
    assert staff.status_code == 201, staff.text
    other_business = actors["other"]["businessId"]
    other_response = submit(client, other_business, actors["other"], payload(ratings={"ic_1": 1}))
    assert other_response.status_code == 201, other_response.text
    response = client.get(survey_base(business) + "/export.csv", headers=actors["owner"]["readHeaders"])
    assert response.status_code == 200, response.text
    assert "X-CSRF-Token" not in response.request.headers
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    parsed = csv.DictReader(io.StringIO(response.text))
    assert parsed.fieldnames == CSV_COLUMNS
    rows = list(parsed)
    assert len(rows) == 24
    assert {row["business_id"] for row in rows} == {business}
    assert {row["participant_role"] for row in rows} == {"owner_manager", "staff"}
    assert {row["data_origin"] for row in rows} == {"demo"}
    assert {row["questionnaire_version"] for row in rows} == {VERSION}
    assert other_response.json()["data"]["submissionId"] not in response.text
    assert "synthetic.survey.staff@example.test" not in response.text
    assert "HYPERLINK" not in response.text
    owner_items = {row["item_id"]: row for row in rows if row["user_id"] == actors["owner"]["userId"]}
    assert set(owner_items) == set(ITEM_IDS)
    assert owner_items["fs_1"]["rating"] == "5" and owner_items["fs_1"]["response_status"] == "rated"
    assert owner_items["fs_2"]["rating"] == "" and owner_items["fs_2"]["response_status"] == "not_applicable"
    assert owner_items["fs_3"]["rating"] == "" and owner_items["fs_3"]["response_status"] == "unanswered"
    assert {row["submitted_at"] for row in owner_items.values()} == {first.json()["data"]["submittedAt"]}
    for row in rows:
        assert row["characteristic_id"] in CHARACTERISTICS
        assert row["item_text"] and row["item_text"][0] not in ("=", "+", "-", "@", "\t", "\r")
    denied = client.get(survey_base(business) + "/export.csv", headers=actors["staff"]["readHeaders"])
    assert denied.status_code == 403


def test_foreign_business_and_uuid_reuse_never_disclose_other_responses(survey_client):
    client, business, _dsn, actors = survey_client
    body = payload(ratings={"fs_1": 5})
    saved = submit(client, business, actors["owner"], body)
    assert saved.status_code == 201
    for key in ("staff", "other"):
        actor = actors[key]
        collision = submit(client, actor["businessId"], actor, body)
        assert collision.status_code == 409
        assert actors["owner"]["userId"] not in collision.text
        assert "answers" not in collision.json()
        assert read(client, actor["businessId"], actor, "/submissions") == []
    foreign_business = actors["other"]["businessId"]
    for actor, target in [(actors["owner"], foreign_business), (actors["other"], business), (actors["staff"], foreign_business)]:
        for endpoint in ("/questionnaire", "/submissions", "/summary", "/export.csv"):
            assert client.get(survey_base(target) + endpoint, headers=actor["readHeaders"]).status_code == 403
        assert submit(client, target, actor, payload(ratings={"fs_1": 1})).status_code == 403
    assert read(client, business, actors["owner"], "/submissions") == [saved.json()["data"]]


def test_survey_write_csrf_origin_and_session_are_required_but_reads_use_plain_get(survey_client):
    client, business, _dsn, actors = survey_client
    actor = actors["owner"]
    base = survey_base(business)
    body = payload(ratings={"fs_1": 3})
    missing_header = client.post(base + "/submissions", json=body, headers=actor["readHeaders"])
    assert missing_header.status_code == 403
    wrong_header = {**actor["writeHeaders"], "X-CSRF-Token": "synthetic-mismatched-csrf"}
    assert client.post(base + "/submissions", json=body, headers=wrong_header).status_code == 403
    missing_cookie = {**actor["writeHeaders"], "Cookie": f"stockcast_session={actor['session']}"}
    assert client.post(base + "/submissions", json=body, headers=missing_cookie).status_code == 403
    foreign_origin = {**actor["writeHeaders"], "Origin": "https://foreign.synthetic.example.test"}
    assert client.post(base + "/submissions", json=body, headers=foreign_origin).status_code == 403
    assert read(client, business, actor, "/submissions") == []
    for endpoint in ("/questionnaire", "/submissions", "/summary", "/export.csv"):
        response = client.get(base + endpoint, headers={"Cookie": ""})
        assert response.status_code == 401
    assert client.post(base + "/submissions", json=body, headers={"Cookie": ""}).status_code == 401
    assert submit(client, business, actor, body).status_code == 201


def test_invalid_ratings_versions_missing_items_and_identity_spoofs_are_rejected(survey_client):
    client, business, _dsn, actors = survey_client
    actor = actors["owner"]
    body = payload(ratings={"fs_1": 3})
    invalid = []
    for rating in (True, False, 0, 6, -1, 1.5, "5", None):
        candidate = json.loads(json.dumps(body))
        candidate["answers"][0]["rating"] = rating
        invalid.append((f"invalid rating {rating!r}", candidate))
    invalid.extend([
        ("unknown version", {**body, "questionnaireVersion": "unapproved-survey-v2"}),
        ("malformed UUID", {**body, "submissionId": "synthetic-invalid-id"}),
        ("missing item", {**body, "answers": body["answers"][:-1]}),
        ("duplicate item", {**body, "answers": [body["answers"][0], *body["answers"][:-1]]}),
        ("no rated responses", payload(not_applicable=set(ITEM_IDS))),
    ])
    for field, value in {
        "participantRole": "owner_manager", "userId": actors["staff"]["userId"],
        "businessId": actors["other"]["businessId"], "submittedAt": "2020-01-01T00:00:00Z",
        "dataOrigin": "partner", "unexpected": "ignored fields are unacceptable",
    }.items():
        invalid.append((f"spoofed {field}", {**body, field: value}))
    for change in [
        {"itemId": "maintainability_1"}, {"responseStatus": "maybe"},
        {"responseStatus": "not_applicable", "rating": 3},
        {"responseStatus": "unanswered", "rating": 3}, {"unexpected": True},
    ]:
        candidate = json.loads(json.dumps(body))
        candidate["answers"][0].update(change)
        invalid.append((f"invalid answer fields {list(change)}", candidate))
    for label, candidate in invalid:
        response = submit(client, business, actor, candidate)
        assert response.status_code == 422, (label, response.status_code, response.text)
    assert read(client, business, actor, "/submissions") == []
    # All agreement points 1..5 are valid; rating zero never stands for missing/NA.
    valid = payload(ratings=dict(zip(ITEM_IDS[:5], range(1, 6), strict=True)))
    assert submit(client, business, actor, valid).status_code == 201


def test_two_simultaneous_same_uuid_submissions_commit_one_final_response(survey_client):
    from app.auth_repository import AuthRepository
    from app.security import Principal

    client, business, dsn, actors = survey_client
    body = payload(ratings={"fs_1": 4})
    barrier = Barrier(2)
    first_actor = actors["owner"]
    with psycopg.connect(dsn, row_factory=psycopg.rows.dict_row) as conn:
        session, csrf, _ = AuthRepository(conn).issue_session(
            Principal(first_actor["userId"], business, "owner@example.com", "Synthetic Owner", "owner"), 12,
        )
    # Different sessions ensure authentication's session-row update cannot serialize the two writes.
    second_actor = {**first_actor, "writeHeaders": {
        **first_actor["writeHeaders"],
        "Cookie": f"stockcast_session={session}; stockcast_csrf={csrf}", "X-CSRF-Token": csrf,
    }}

    def concurrent_submit(actor):
        barrier.wait(timeout=10)
        return submit(client, business, actor, body)

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(concurrent_submit, (first_actor, second_actor)))
    assert sorted(response.status_code for response in responses) == [200, 201]
    assert responses[0].json()["data"] == responses[1].json()["data"]
    assert len(read(client, business, actors["owner"], "/submissions")) == 1
    summary = read(client, business, actors["owner"], "/summary")
    assert summary["participantCount"] == summary["validResponseCount"] == 1
    assert_mean(summary["overallWeightedMean"], 4)


def test_submission_provenance_snapshot_survives_later_business_label_change(survey_client):
    client, business, dsn, actors = survey_client
    body = payload(ratings={"fs_1": 2})
    response = submit(client, business, actors["owner"], body)
    assert response.status_code == 201, response.text
    saved = response.json()["data"]
    assert saved["dataOrigin"] == "demo"
    # This isolated synthetic test changes only a metadata label; it is not actual partner data.
    with psycopg.connect(dsn) as conn:
        conn.execute("UPDATE businesses SET data_origin='partner' WHERE id=%s", (business,))
    summary = read(client, business, actors["owner"], "/summary")
    assert summary["businessDataOrigin"] == "partner"
    assert summary["submissionDataOrigins"] == {"demo": 1, "partner": 0}
    assert read(client, business, actors["owner"], "/submissions") == [saved]
    replay = submit(client, business, actors["owner"], body)
    assert replay.status_code == 200
    assert replay.json()["data"] == saved
    response = client.get(survey_base(business) + "/export.csv", headers=actors["owner"]["readHeaders"])
    assert response.status_code == 200
    assert {row["data_origin"] for row in csv.DictReader(io.StringIO(response.text))} == {"demo"}
