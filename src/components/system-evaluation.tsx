import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ISO_ITEMS, accountIsoStorageKey, loadIsoScores } from "@/lib/iso-eval";
import { num } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { api, type SessionUser } from "@/lib/api";
import { Select } from "@/components/ui/select";
import {
  CLIENT_SURVEY,
  changeSurveyAnswer,
  clientSurveyStorageKey,
  emptyClientSurveyDraft,
  loadClientSurveyDraft,
  saveClientSurveyDraft,
  surveyDraftCounts,
  type ClientSurveyDraft,
  type SurveyQuestionnaire,
  type SurveyStatistics,
  type SurveySubmission,
  type SurveySummary,
} from "@/lib/client-survey";

export function SystemEvaluation() {
  const mode = useAppStore((state) => state.dataMode);
  const session = useAppStore((state) => state.session);
  const dataOrigin = useAppStore((state) => state.dataOrigin);
  if (mode === "api" && !session) return <p>Sign in to open the evaluation form.</p>;
  const storageKey =
    mode === "api" && session
      ? accountIsoStorageKey(session.businessId, session.userId)
      : undefined;
  return (
    <div className="grid gap-6">
      <ClientSurveyForm
        key={
          mode +
          ":" +
          (session?.businessId ?? "demo") +
          ":" +
          (session?.userId ?? "demo") +
          ":" +
          session?.role
        }
        mode={mode}
        session={session}
        dataOrigin={dataOrigin}
      />
      <Card>
        <CardHeader>
          <CardTitle>Maintainability review</CardTitle>
          <CardDescription>
            Maintainability is assessed separately through code, documentation, and change reviews.
            It is not included in client scores.
          </CardDescription>
        </CardHeader>
      </Card>
      <ArchivedBrowserRatings key={storageKey ?? "browser-demo"} storageKey={storageKey} />
    </div>
  );
}

export function ClientSurveyForm({
  mode,
  session,
  dataOrigin,
}: {
  mode: "api" | "browser-demo";
  session: SessionUser | null;
  dataOrigin: "demo" | "partner";
}) {
  const storageKey = clientSurveyStorageKey(
    mode === "api" ? session?.businessId : undefined,
    mode === "api" ? session?.userId : undefined,
  );
  const [initial] = useState(() => {
    try {
      return { draft: loadClientSurveyDraft(storageKey), error: "" };
    } catch {
      return {
        draft: emptyClientSurveyDraft(),
        error:
          "Browser storage is unavailable. Answers can stay on this page, but drafts cannot be restored.",
      };
    }
  });
  const [draft, setDraft] = useState<ClientSurveyDraft>(initial.draft);
  const [questionnaire, setQuestionnaire] = useState<SurveyQuestionnaire>(CLIENT_SURVEY);
  const [submissions, setSubmissions] = useState<SurveySubmission[]>([]);
  const [summary, setSummary] = useState<SurveySummary | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "error">(
    mode === "api" ? "loading" : "ready",
  );
  const [readError, setReadError] = useState("");
  const [formError, setFormError] = useState("");
  const [storageError, setStorageError] = useState(initial.error);
  const [saved, setSaved] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const requests = useRef(0);
  const writePending = useRef(false);
  const owner = mode === "api" && session?.role === "owner";
  const ownSubmission = submissions.find(
    (item) =>
      item.userId === session?.userId && item.questionnaireVersion === CLIENT_SURVEY.version,
  );
  const counts = surveyDraftCounts(draft.answers);
  const locked = busy || draft.lockedForRetry || Boolean(ownSubmission);
  const testFeedback =
    mode === "browser-demo" || (summary?.businessDataOrigin ?? dataOrigin) === "demo";

  const isCurrent = useCallback(() => {
    if (!alive.current) return false;
    const current = useAppStore.getState();
    return mode === "browser-demo"
      ? current.dataMode === "browser-demo"
      : current.dataMode === "api" &&
          current.session?.businessId === session?.businessId &&
          current.session?.userId === session?.userId &&
          current.session?.role === session?.role;
  }, [mode, session]);

  const reload = useCallback(async () => {
    if (mode !== "api" || !session || !isCurrent()) return;
    const requestId = ++requests.current;
    setReadState("loading");
    setReadError("");
    try {
      const [definition, records, statistics] = await Promise.all([
        api.surveyQuestionnaire(session.businessId),
        api.surveySubmissions(session.businessId),
        api.surveySummary(session.businessId),
      ]);
      if (!isCurrent() || requestId !== requests.current) return;
      if (
        definition.version !== CLIENT_SURVEY.version ||
        statistics.questionnaireVersion !== CLIENT_SURVEY.version
      )
        throw new Error(
          "The questionnaire version changed. Reload the application before submitting.",
        );
      setQuestionnaire(definition);
      setSubmissions(records);
      setSummary(statistics);
      setReadState("ready");
    } catch (error) {
      if (!isCurrent() || requestId !== requests.current) return;
      setReadState("error");
      setReadError(
        error instanceof Error ? error.message : "Submitted feedback could not be loaded.",
      );
    }
  }, [isCurrent, mode, session]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  function saveDraft(value = draft) {
    try {
      saveClientSurveyDraft(storageKey, value);
      setStorageError("");
      setSaved(true);
      return true;
    } catch {
      setSaved(false);
      setStorageError(
        "Draft could not be saved in this browser. Your answers remain on this page.",
      );
      return false;
    }
  }

  async function submit() {
    if (
      writePending.current ||
      mode !== "api" ||
      !session ||
      readState !== "ready" ||
      ownSubmission ||
      !isCurrent()
    )
      return;
    if (!counts.rated) {
      setFormError(
        "Rate at least one item before submitting. Unanswered and Not applicable are excluded from scores.",
      );
      return;
    }
    writePending.current = true;
    setBusy(true);
    setFormError("");
    const attempt = { ...draft, lockedForRetry: true };
    setDraft(attempt);
    saveDraft(attempt);
    try {
      const record = await api.submitSurvey(session.businessId, {
        questionnaireVersion: attempt.questionnaireVersion,
        submissionId: attempt.submissionId,
        answers: attempt.answers,
      });
      if (!isCurrent()) return;
      setSubmissions((previous) => [
        record,
        ...previous.filter((item) => item.submissionId !== record.submissionId),
      ]);
      setSubmitted(true);
      toast.success("Submission saved to the server.");
      await reload();
    } catch (error) {
      if (!isCurrent()) return;
      setFormError(
        (error instanceof Error ? error.message : "Submission could not be confirmed.") +
          " Your draft is retained. Retry sends the same submission and answers; Refresh submitted feedback can check whether it was saved.",
      );
    } finally {
      writePending.current = false;
      if (isCurrent()) setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{questionnaire.title}</CardTitle>
          <CardDescription>{questionnaire.notice}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {testFeedback && (
            <p className="rounded-xl bg-surface-2 p-3 text-sm font-medium">
              Test feedback: this store uses demonstration records. These responses are not actual
              client findings.
            </p>
          )}
          <p className="text-sm text-muted">
            Save draft keeps answers in this browser for this account. Submit saves a final server
            record with your authenticated role and submission time. Each account can submit once
            for this questionnaire version; a final submission cannot be edited. Rate features you
            have used, or choose Not applicable.
          </p>
          <p className="text-xs text-muted">Questionnaire version: {questionnaire.version}</p>
          {mode === "browser-demo" && (
            <p role="status" className="text-sm text-muted">
              Browser demonstration: drafts only. Server collection and submission are unavailable.
            </p>
          )}
          {questionnaire.characteristics.map((characteristic) => (
            <fieldset key={characteristic.id} className="grid gap-4">
              <legend className="mb-3 font-medium">{characteristic.label}</legend>
              {questionnaire.items
                .filter((item) => item.characteristicId === characteristic.id)
                .map((item) => {
                  const answer = (ownSubmission?.answers ?? draft.answers).find(
                    (value) => value.itemId === item.id,
                  );
                  return (
                    <div
                      key={item.id}
                      className="grid gap-2 sm:grid-cols-[1fr_15rem] sm:items-center"
                    >
                      <label htmlFor={"survey-" + item.id} className="text-sm">
                        {item.text}
                      </label>
                      <Select
                        id={"survey-" + item.id}
                        value={
                          answer?.responseStatus === "rated"
                            ? String(answer.rating)
                            : answer?.responseStatus === "not_applicable"
                              ? "not_applicable"
                              : ""
                        }
                        disabled={locked}
                        onChange={(event) => {
                          setDraft((previous) =>
                            changeSurveyAnswer(previous, item.id, event.target.value),
                          );
                          setSaved(false);
                          setFormError("");
                        }}
                      >
                        <option value="">Unanswered</option>
                        {questionnaire.scale.map((rating) => (
                          <option key={rating.value} value={rating.value}>
                            {rating.value} — {rating.label}
                          </option>
                        ))}
                        <option value="not_applicable">Not applicable</option>
                      </Select>
                    </div>
                  );
                })}
            </fieldset>
          ))}
          <p role="status" className="text-sm text-muted">
            {counts.rated} rated, {counts.notApplicable} Not applicable, {counts.unanswered}{" "}
            unanswered in your browser draft. Unanswered and Not applicable do not contribute to
            means.
          </p>
          {draft.lockedForRetry && !ownSubmission && (
            <p className="text-sm text-muted">
              Answers are held unchanged until this submission is confirmed, so retry can safely
              send the same record.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || Boolean(ownSubmission)}
              onClick={() => saveDraft()}
            >
              Save draft
            </Button>
            <Button
              disabled={mode !== "api" || busy || readState !== "ready" || Boolean(ownSubmission)}
              onClick={() => void submit()}
            >
              {busy
                ? "Submitting…"
                : ownSubmission
                  ? "Already submitted"
                  : draft.lockedForRetry
                    ? "Retry submission"
                    : "Submit"}
            </Button>
          </div>
          {saved && !submitted && (
            <p role="status" className="text-sm text-primary">
              Draft saved in this browser only.
            </p>
          )}
          {submitted && (
            <p role="status" className="text-sm text-primary">
              Final submission saved to the server.
            </p>
          )}
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          {storageError && (
            <p role="alert" className="text-sm text-danger">
              {storageError}
            </p>
          )}
        </CardContent>
      </Card>
      {mode === "api" && (
        <Card>
          <CardHeader>
            <CardTitle>{owner ? "Store submitted feedback" : "Your submitted feedback"}</CardTitle>
            <CardDescription>
              These counts and means come from durable server submissions, separate from browser
              drafts.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={readState === "loading" || busy}
                onClick={() => void reload()}
              >
                Refresh submitted feedback
              </Button>
              {owner && readState === "ready" && (
                <a
                  className="inline-flex h-11 items-center rounded-lg border border-border px-4 text-sm font-medium"
                  href={api.surveyExportUrl(session!.businessId)}
                  download
                >
                  Download submitted CSV
                </a>
              )}
            </div>
            {readState === "loading" && (
              <p role="status" className="text-sm text-muted">
                Loading submitted feedback…
              </p>
            )}
            {readState === "error" && (
              <div className="grid gap-2">
                <p role="alert" className="text-sm text-danger">
                  {readError}
                </p>
                <Button variant="outline" onClick={() => void reload()}>
                  Retry loading feedback
                </Button>
              </div>
            )}
            {readState === "ready" && summary && (
              <>
                <p className="text-sm text-muted">
                  {summary.scope === "business"
                    ? "All submitted participants in this store"
                    : "Your submission only"}
                  .{" "}
                  {summary.submissionDataOrigins.demo > 0
                    ? `${summary.submissionDataOrigins.demo} test submissions and ${summary.submissionDataOrigins.partner} partner-origin submissions. Aggregates containing test feedback are not actual client findings.`
                    : testFeedback
                      ? "Test feedback, not actual client findings."
                      : "Submitted participant feedback; it does not certify standards compliance."}
                </p>
                <StatisticsTable statistics={summary} questionnaire={questionnaire} />
                {owner &&
                  summary.byRole.map((role) => (
                    <div key={role.participantRole} className="grid gap-2">
                      <h3 className="text-sm font-medium">
                        {role.participantRole === "owner_manager" ? "Owner / manager" : "Staff"}
                      </h3>
                      <StatisticsTable statistics={role} questionnaire={questionnaire} />
                    </div>
                  ))}
                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Item counts and response frequencies
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr>
                          <th className="p-2">Item</th>
                          <th className="p-2">Mean / 5</th>
                          <th className="p-2">Rated</th>
                          <th className="p-2">1 / 2 / 3 / 4 / 5 counts</th>
                          <th className="p-2">Unanswered</th>
                          <th className="p-2">Not applicable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.items.map((item) => (
                          <tr key={item.itemId} className="border-t border-border">
                            <th className="p-2 font-normal">
                              {questionnaire.items.find(
                                (definition) => definition.id === item.itemId,
                              )?.text ?? item.itemId}
                            </th>
                            <td className="p-2">
                              {item.weightedMean == null ? "—" : num(item.weightedMean, 2)}
                            </td>
                            <td className="p-2">{item.validResponseCount}</td>
                            <td className="p-2">
                              {["1", "2", "3", "4", "5"]
                                .map(
                                  (rating) =>
                                    item.responseCounts[rating as "1" | "2" | "3" | "4" | "5"],
                                )
                                .join(" / ")}
                            </td>
                            <td className="p-2">{item.unansweredCount}</td>
                            <td className="p-2">{item.notApplicableCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <div className="grid gap-1 border-t border-border pt-4">
                  <h3 className="text-sm font-medium">Your final submission</h3>
                  {ownSubmission ? (
                    <p className="text-sm text-muted">
                      Saved at {new Date(ownSubmission.submittedAt).toLocaleString()} (
                      {ownSubmission.participantRole === "owner_manager"
                        ? "Owner / manager"
                        : "Staff"}
                      ).{" "}
                      {ownSubmission.dataOrigin === "demo"
                        ? "Test feedback."
                        : "Participant feedback."}{" "}
                      Server time: {ownSubmission.submittedAt}
                    </p>
                  ) : (
                    <p className="text-sm text-muted">
                      You have not submitted this questionnaire version.
                    </p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatisticsTable({
  statistics,
  questionnaire,
}: {
  statistics: SurveyStatistics;
  questionnaire: SurveyQuestionnaire;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm">
        {statistics.participantCount} participants · {statistics.validResponseCount} rated answers ·
        Weighted mean{" "}
        {statistics.overallWeightedMean == null ? "—" : num(statistics.overallWeightedMean, 2)} / 5
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">Characteristic</th>
              <th className="p-2">Mean / 5</th>
              <th className="p-2">Rated answers</th>
              <th className="p-2">Contributing participants</th>
            </tr>
          </thead>
          <tbody>
            {statistics.characteristics.map((item) => (
              <tr key={item.characteristicId} className="border-t border-border">
                <th className="p-2 font-normal">
                  {questionnaire.characteristics.find(
                    (definition) => definition.id === item.characteristicId,
                  )?.label ?? item.characteristicId}
                </th>
                <td className="p-2">
                  {item.weightedMean == null ? "—" : num(item.weightedMean, 2)}
                </td>
                <td className="p-2">{item.validResponseCount}</td>
                <td className="p-2">{item.participantCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArchivedBrowserRatings({ storageKey }: { storageKey?: string }) {
  const [scores] = useState(() => loadIsoScores(storageKey));
  if (!ISO_ITEMS.some((item) => scores[item.id] > 0)) return null;
  return (
    <details className="rounded-xl border border-border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Archived browser-only ratings
      </summary>
      <p className="my-3 text-sm text-muted">
        These earlier five-category ratings remain private and read-only in this browser. They are
        never migrated, submitted, or interpreted as current questionnaire responses.
      </p>
      <dl className="grid gap-2 text-sm">
        {ISO_ITEMS.map((item) => (
          <div key={item.id} className="flex flex-wrap justify-between gap-2">
            <dt>{item.title}</dt>
            <dd>{scores[item.id] > 0 ? scores[item.id] + " / 5 (earlier scale)" : "Unanswered"}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
