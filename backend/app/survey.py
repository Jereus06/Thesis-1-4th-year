"""Authenticated, immutable client survey records and item-level aggregation."""

import csv
import hashlib
import io
import json
from datetime import UTC
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import ConfigDict, Field, StrictInt, model_validator

from .auth_routes import origin_guard
from .config import get_settings
from .schemas import ApiModel
from .security import Principal


QUESTIONNAIRE = json.loads(
    Path(__file__).with_name("client_survey_v1.json").read_text(encoding="utf-8")
)
VERSION = QUESTIONNAIRE["version"]
ITEMS = {item["id"]: item for item in QUESTIONNAIRE["items"]}


class SurveyAnswer(ApiModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str = Field(min_length=1, max_length=80)
    rating: Annotated[StrictInt, Field(ge=1, le=5)] | None
    response_status: Literal["rated", "unanswered", "not_applicable"]

    @model_validator(mode="after")
    def status_matches_rating(self):
        if (self.response_status == "rated") != (self.rating is not None):
            raise ValueError("Rated answers require a rating; unanswered and not applicable require null")
        return self


class SurveySubmissionCreate(ApiModel):
    model_config = ConfigDict(extra="forbid")
    questionnaire_version: Literal[VERSION]
    submission_id: UUID
    answers: list[SurveyAnswer] = Field(min_length=len(ITEMS), max_length=len(ITEMS))

    @model_validator(mode="after")
    def complete_questionnaire(self):
        if {answer.item_id for answer in self.answers} != set(ITEMS):
            raise ValueError("Provide each questionnaire item exactly once")
        if not any(answer.response_status == "rated" for answer in self.answers):
            raise ValueError("At least one item must have a rating before final submission")
        return self

    def normalized_answers(self):
        answers = {answer.item_id: answer for answer in self.answers}
        return [answers[item_id].model_dump(by_alias=True) for item_id in ITEMS]


def submission_row(row):
    answers = {answer["itemId"]: answer for answer in row["answers"]}
    return {
        "submissionId": str(row["id"]),
        "questionnaireVersion": row["questionnaire_version"],
        "businessId": str(row["business_id"]),
        "userId": str(row["user_id"]),
        "participantRole": row["participant_role"],
        "dataOrigin": row["data_origin"],
        "submittedAt": row["submitted_at"].astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "answers": [answers[item_id] for item_id in ITEMS],
    }


def survey_statistics(submissions: list[dict[str, Any]]) -> dict[str, Any]:
    """Equal weight per valid rated response, excluding unanswered and NA."""
    item_scores = {}
    for item_id in ITEMS:
        answers = [
            answer for submission in submissions for answer in submission["answers"]
            if answer["itemId"] == item_id
        ]
        ratings = [answer["rating"] for answer in answers if answer["responseStatus"] == "rated"]
        item_scores[item_id] = {
            "itemId": item_id,
            "weightedMean": sum(ratings) / len(ratings) if ratings else None,
            "validResponseCount": len(ratings),
            "responseCounts": {str(rating): ratings.count(rating) for rating in range(1, 6)},
            "unansweredCount": sum(answer["responseStatus"] == "unanswered" for answer in answers),
            "notApplicableCount": sum(answer["responseStatus"] == "not_applicable" for answer in answers),
        }
    characteristics = []
    for characteristic in QUESTIONNAIRE["characteristics"]:
        characteristic_ids = {
            item_id for item_id, item in ITEMS.items()
            if item["characteristicId"] == characteristic["id"]
        }
        ratings = [
            answer["rating"] for submission in submissions for answer in submission["answers"]
            if answer["itemId"] in characteristic_ids and answer["responseStatus"] == "rated"
        ]
        contributors = sum(
            any(answer["itemId"] in characteristic_ids and answer["responseStatus"] == "rated"
                for answer in submission["answers"])
            for submission in submissions
        )
        characteristics.append({
            "characteristicId": characteristic["id"],
            "weightedMean": sum(ratings) / len(ratings) if ratings else None,
            "validResponseCount": len(ratings),
            "participantCount": contributors,
        })
    ratings = [
        answer["rating"] for submission in submissions for answer in submission["answers"]
        if answer["responseStatus"] == "rated"
    ]
    return {
        "participantCount": len(submissions),
        "validResponseCount": len(ratings),
        "overallWeightedMean": sum(ratings) / len(ratings) if ratings else None,
        "characteristics": characteristics,
        "items": list(item_scores.values()),
    }


class SurveyRepository:
    def __init__(self, conn):
        self.conn = conn
        self.conn.row_factory = dict_row

    def submissions(self, user: Principal):
        rows = self.conn.execute(
            """SELECT s.*,jsonb_agg(jsonb_build_object(
                       'itemId',a.item_id,'rating',a.rating,'responseStatus',a.response_status)
                       ORDER BY a.item_id) AS answers
               FROM client_survey_submissions s JOIN client_survey_answers a ON a.submission_id=s.id
               WHERE s.business_id=%s AND s.questionnaire_version=%s
                 AND (%s OR s.user_id=%s)
               GROUP BY s.id ORDER BY s.submitted_at,s.id""",
            (user.business_id, VERSION, user.role == "owner", user.user_id),
        ).fetchall()
        return [submission_row(row) for row in rows]

    def submit(self, user: Principal, data: SurveySubmissionCreate):
        answers = data.normalized_answers()
        fingerprint = hashlib.sha256(json.dumps(
            {"questionnaireVersion": data.questionnaire_version, "answers": answers},
            sort_keys=True, separators=(",", ":"),
        ).encode()).hexdigest()
        with self.conn.transaction():
            # Serialize this participant's final submission and capture current
            # authenticated membership/provenance, without trusting client roles.
            member = self.conn.execute(
                """SELECT u.id,u.role,b.data_origin FROM users u
                   JOIN businesses b ON b.id=u.business_id
                   WHERE u.id=%s AND u.business_id=%s AND u.is_active FOR UPDATE OF u""",
                (user.user_id, user.business_id),
            ).fetchone()
            if not member:
                raise HTTPException(401, "Sign in is required")
            existing = self.conn.execute(
                """SELECT id,request_fingerprint FROM client_survey_submissions
                   WHERE business_id=%s AND user_id=%s AND questionnaire_version=%s""",
                (user.business_id, user.user_id, VERSION),
            ).fetchone()
            if existing:
                if str(existing["id"]) != str(data.submission_id) or existing["request_fingerprint"] != fingerprint:
                    raise HTTPException(409, "A final response is already saved for this questionnaire version")
                saved = next(item for item in self.submissions(user)
                             if item["submissionId"] == str(existing["id"]))
                return saved, False
            inserted = self.conn.execute(
                """INSERT INTO client_survey_submissions
                   (id,business_id,user_id,questionnaire_version,participant_role,data_origin,
                    request_fingerprint,questionnaire_snapshot)
                   VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING RETURNING id""",
                (data.submission_id, user.business_id, user.user_id, VERSION,
                 "owner_manager" if member["role"] == "owner" else "staff", member["data_origin"],
                 fingerprint, Jsonb(QUESTIONNAIRE)),
            ).fetchone()
            if not inserted:
                raise HTTPException(409, "Submission identifier was already used")
            for answer in answers:
                item = ITEMS[answer["itemId"]]
                self.conn.execute(
                    """INSERT INTO client_survey_answers
                       (submission_id,item_id,characteristic_id,item_text,response_status,rating)
                       VALUES(%s,%s,%s,%s,%s,%s)""",
                    (data.submission_id, item["id"], item["characteristicId"], item["text"],
                     answer["responseStatus"], answer["rating"]),
                )
            saved = next(item for item in self.submissions(user)
                         if item["submissionId"] == str(data.submission_id))
            return saved, True

    def summary(self, user: Principal):
        submissions = self.submissions(user)
        origin = self.conn.execute(
            "SELECT data_origin FROM businesses WHERE id=%s", (user.business_id,)
        ).fetchone()["data_origin"]
        roles = ["owner_manager", "staff"] if user.role == "owner" else ["staff"]
        return {
            "questionnaireVersion": VERSION,
            "scope": "business" if user.role == "owner" else "own",
            "businessDataOrigin": origin,
            "submissionDataOrigins": {
                origin: sum(item["dataOrigin"] == origin for item in submissions)
                for origin in ("demo", "partner")
            },
            **survey_statistics(submissions),
            "byRole": [
                {"participantRole": role, **survey_statistics([
                    item for item in submissions if item["participantRole"] == role
                ])} for role in roles
            ],
        }

    def export(self, user: Principal):
        # Route authorization also checks this; keep repository export safe itself.
        if user.role != "owner":
            raise HTTPException(403, "Owner role required")
        return self.conn.execute(
            """SELECT s.id AS submission_id,s.questionnaire_version,s.submitted_at,
                      s.business_id,s.user_id,s.participant_role,s.data_origin,
                      a.characteristic_id,a.item_id,a.item_text,a.response_status,a.rating
               FROM client_survey_submissions s JOIN client_survey_answers a ON a.submission_id=s.id
               WHERE s.business_id=%s AND s.questionnaire_version=%s
               ORDER BY s.submitted_at,s.id,a.item_id""",
            (user.business_id, VERSION),
        ).fetchall()


def create_survey_router(repository_dependency, principal_dependency, csrf_dependency, business_check):
    router = APIRouter(prefix="/api/v1/businesses/{business_id}/survey", tags=["client survey"])

    @router.get("/questionnaire")
    def questionnaire(business_id: str, user: Principal = Depends(principal_dependency)):
        business_check(business_id, user)
        return {"data": QUESTIONNAIRE}

    @router.get("/submissions")
    def submissions(
        business_id: str, repository=Depends(repository_dependency),
        user: Principal = Depends(principal_dependency),
    ):
        business_check(business_id, user)
        return {"data": SurveyRepository(repository.conn).submissions(user)}

    @router.post("/submissions", status_code=201)
    def submit(
        business_id: str, data: SurveySubmissionCreate, request: Request, response: Response,
        repository=Depends(repository_dependency), user: Principal = Depends(csrf_dependency),
    ):
        origin_guard(request, get_settings())
        business_check(business_id, user)
        saved, created = SurveyRepository(repository.conn).submit(user, data)
        response.status_code = 201 if created else 200
        return {"data": saved}

    @router.get("/summary")
    def summary(
        business_id: str, repository=Depends(repository_dependency),
        user: Principal = Depends(principal_dependency),
    ):
        business_check(business_id, user)
        return {"data": SurveyRepository(repository.conn).summary(user)}

    @router.get("/export.csv")
    def export(
        business_id: str, repository=Depends(repository_dependency),
        user: Principal = Depends(principal_dependency),
    ):
        business_check(business_id, user)
        if user.role != "owner":
            raise HTTPException(403, "Owner role required")
        rows = SurveyRepository(repository.conn).export(user)
        columns = [
            "submission_id", "questionnaire_version", "submitted_at", "business_id", "user_id",
            "participant_role", "data_origin", "characteristic_id", "item_id", "item_text",
            "response_status", "rating",
        ]
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(columns)
        for row in rows:
            row["submitted_at"] = row["submitted_at"].astimezone(UTC).isoformat().replace("+00:00", "Z")
            writer.writerow([row[column] if row[column] is not None else "" for column in columns])
        return Response(output.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="stockcast-client-survey.csv"'})

    return router
