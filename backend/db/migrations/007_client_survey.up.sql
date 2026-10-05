BEGIN;

CREATE TABLE client_survey_submissions (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  questionnaire_version text NOT NULL CHECK (btrim(questionnaire_version) <> ''),
  participant_role text NOT NULL CHECK (participant_role IN ('owner_manager', 'staff')),
  data_origin data_origin NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  request_fingerprint text NOT NULL,
  questionnaire_snapshot jsonb NOT NULL,
  FOREIGN KEY (business_id, user_id) REFERENCES users(business_id, id) ON DELETE RESTRICT,
  UNIQUE (business_id, user_id, questionnaire_version),
  UNIQUE (business_id, id)
);

CREATE TABLE client_survey_answers (
  submission_id uuid NOT NULL REFERENCES client_survey_submissions(id) ON DELETE CASCADE,
  item_id text NOT NULL CHECK (btrim(item_id) <> ''),
  characteristic_id text NOT NULL CHECK (characteristic_id IN (
    'functional_suitability', 'reliability', 'interaction_capability',
    'perceived_performance_efficiency'
  )),
  item_text text NOT NULL CHECK (btrim(item_text) <> ''),
  response_status text NOT NULL CHECK (response_status IN ('rated', 'unanswered', 'not_applicable')),
  rating smallint,
  PRIMARY KEY (submission_id, item_id),
  CHECK (
    (response_status = 'rated' AND rating IS NOT NULL AND rating BETWEEN 1 AND 5)
    OR (response_status IN ('unanswered', 'not_applicable') AND rating IS NULL)
  )
);

CREATE INDEX client_survey_submissions_business_date_idx
  ON client_survey_submissions(business_id, questionnaire_version, submitted_at, id);

COMMIT;
