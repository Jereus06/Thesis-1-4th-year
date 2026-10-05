import canonicalQuestionnaire from "../../backend/app/client_survey_v1.json";

export type SurveyRating = 1 | 2 | 3 | 4 | 5;
export type SurveyResponseStatus = "rated" | "unanswered" | "not_applicable";
export type SurveyAnswer = {
  itemId: string;
  rating: SurveyRating | null;
  responseStatus: SurveyResponseStatus;
};
export type SurveyQuestionnaire = {
  version: string;
  title: string;
  notice: string;
  characteristics: { id: string; label: string }[];
  items: { id: string; characteristicId: string; text: string }[];
  scale: { value: SurveyRating; label: string }[];
};
export const CLIENT_SURVEY = canonicalQuestionnaire as SurveyQuestionnaire;

export type ClientSurveyDraft = {
  questionnaireVersion: string;
  submissionId: string;
  answers: SurveyAnswer[];
  lockedForRetry: boolean;
};
export type SurveySubmissionInput = Pick<
  ClientSurveyDraft,
  "questionnaireVersion" | "submissionId" | "answers"
>;
export type SurveySubmission = SurveySubmissionInput & {
  businessId: string;
  userId: string;
  participantRole: "owner_manager" | "staff";
  dataOrigin: "demo" | "partner";
  submittedAt: string;
};
export type SurveyStatistics = {
  participantCount: number;
  validResponseCount: number;
  overallWeightedMean: number | null;
  characteristics: {
    characteristicId: string;
    weightedMean: number | null;
    validResponseCount: number;
    participantCount: number;
  }[];
  items: {
    itemId: string;
    weightedMean: number | null;
    validResponseCount: number;
    responseCounts: Record<"1" | "2" | "3" | "4" | "5", number>;
    unansweredCount: number;
    notApplicableCount: number;
  }[];
};
export type SurveySummary = SurveyStatistics & {
  questionnaireVersion: string;
  scope: "business" | "own";
  businessDataOrigin: "demo" | "partner";
  submissionDataOrigins: { demo: number; partner: number };
  byRole: (SurveyStatistics & { participantRole: "owner_manager" | "staff" })[];
};

export function clientSurveyStorageKey(businessId?: string, userId?: string) {
  const prefix = "stockcast-client-survey-draft:" + CLIENT_SURVEY.version;
  return businessId && userId
    ? prefix + ":api:" + encodeURIComponent(businessId) + ":" + encodeURIComponent(userId)
    : prefix + ":browser-demo";
}

export function emptyClientSurveyDraft(): ClientSurveyDraft {
  return {
    questionnaireVersion: CLIENT_SURVEY.version,
    submissionId: crypto.randomUUID(),
    answers: CLIENT_SURVEY.items.map((item) => ({
      itemId: item.id,
      rating: null,
      responseStatus: "unanswered",
    })),
    lockedForRetry: false,
  };
}

function validRating(value: unknown): value is SurveyRating {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function loadClientSurveyDraft(storageKey: string): ClientSurveyDraft {
  const empty = emptyClientSurveyDraft();
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
  const stored = parsed as Record<string, unknown>;
  if (
    stored.questionnaireVersion !== CLIENT_SURVEY.version ||
    typeof stored.submissionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored.submissionId) ||
    !Array.isArray(stored.answers)
  )
    return empty;
  const answers = stored.answers as Partial<SurveyAnswer>[];
  return {
    ...empty,
    submissionId: stored.submissionId,
    lockedForRetry: stored.lockedForRetry === true,
    answers: empty.answers.map((answer) => {
      const value = answers.find((item) => item?.itemId === answer.itemId);
      if (value?.responseStatus === "rated" && validRating(value.rating))
        return { ...answer, rating: value.rating, responseStatus: "rated" };
      if (value?.responseStatus === "not_applicable")
        return { ...answer, responseStatus: "not_applicable" };
      return answer;
    }),
  };
}

export function saveClientSurveyDraft(storageKey: string, draft: ClientSurveyDraft) {
  window.localStorage.setItem(storageKey, JSON.stringify(draft));
}

export function surveyDraftCounts(answers: SurveyAnswer[]) {
  return {
    rated: answers.filter((item) => item.responseStatus === "rated" && validRating(item.rating))
      .length,
    notApplicable: answers.filter((item) => item.responseStatus === "not_applicable").length,
    unanswered: answers.filter((item) => item.responseStatus === "unanswered").length,
  };
}

export function changeSurveyAnswer(
  draft: ClientSurveyDraft,
  itemId: string,
  selection: string,
): ClientSurveyDraft {
  if (draft.lockedForRetry) return draft;
  const rating = Number(selection);
  return {
    ...draft,
    answers: draft.answers.map((answer) =>
      answer.itemId !== itemId
        ? answer
        : validRating(rating)
          ? { ...answer, rating, responseStatus: "rated" }
          : {
              ...answer,
              rating: null,
              responseStatus: selection === "not_applicable" ? "not_applicable" : "unanswered",
            },
    ),
  };
}
