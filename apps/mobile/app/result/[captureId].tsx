import { useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  Alert,
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MOUTH_REGION_DETAILS } from "@stoma3d/contracts";

import { DISCLAIMER } from "@/constants";
import { MaskOverlay } from "@/components/MaskOverlay";
import { Screen } from "@/components/Screen";
import { Button, Card, MetricBar, SectionTitle } from "@/components/Ui";
import { analyzeCapture } from "@/lib/api";
import {
  ADDITIONAL_ANALYSIS_TITLE,
  isReleasedModelOutput,
} from "@/lib/analysisPresentation";
import {
  captureAnalysisRetryDisposition,
  captureStorageRejectionReasons,
} from "@/lib/analysisPolicy";
import { evaluateBundledGuidance } from "@/lib/guidanceRules";
import { scheduleObservationReminder } from "@/lib/notifications";
import { reminderSuggestion } from "@/lib/reminderPolicy";
import { analysisStatusTitle, humanizeResultReason } from "@/lib/resultCopy";
import { nextScanCapture } from "@/lib/usabilityFlow";
import { decryptToTemporaryFile, removeTemporaryFile } from "@/lib/secureFiles";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme } from "@/theme";
import type { IntakeProfile } from "@/types";

export default function ResultRoute() {
  const theme = useAppTheme();
  const { captureId } = useLocalSearchParams<{ captureId?: string }>();
  const capture = useStoma3DStore((state) =>
    state.captures.find((item) => item.id === captureId),
  );
  const analysis = useStoma3DStore((state) =>
    captureId ? state.analyses[captureId] : undefined,
  );
  const observationPin = useStoma3DStore((state) =>
    captureId
      ? state.pins.find((pin) => pin.captureIds.includes(captureId))
      : undefined,
  );
  const pinConfirmed = Boolean(observationPin);
  const confirmObservationPin = useStoma3DStore(
    (state) => state.confirmObservationPin,
  );
  const updateCaptureAnalysis = useStoma3DStore(
    (state) => state.updateCaptureAnalysis,
  );
  const discardCapture = useStoma3DStore((state) => state.discardCapture);
  const setActiveSession = useStoma3DStore((state) => state.setActiveSession);
  const sessions = useStoma3DStore((state) => state.sessions);
  const captures = useStoma3DStore((state) => state.captures);
  const comparisons = useStoma3DStore((state) => state.comparisons);
  const currentProfile = useStoma3DStore((state) => state.profile);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const [researchOpen, setResearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showMask, setShowMask] = useState(true);
  const [openExplanationStep, setOpenExplanationStep] = useState<string | null>(
    null,
  );
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const sessionProfile =
    sessions.find((session) => session.id === capture?.sessionId)
      ?.intakeProfile ?? currentProfile;
  const guidance = evaluateBundledGuidance(
    sessionProfile,
    analysis ? [analysis] : [],
  );
  const reminder = reminderSuggestion(sessionProfile, analysis);
  const relatedComparison = useMemo(
    () =>
      captureId
        ? comparisons
            .filter(
              (comparison) =>
                comparison.baselineCaptureId === captureId ||
                comparison.currentCaptureId === captureId,
            )
            .at(-1)
        : undefined,
    [captureId, comparisons],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") setPreviewEpoch((value) => value + 1);
      else setPreviewUri(null);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setPreviewUri(null);
    setPreviewError(null);
    if (!capture?.encryptedUri) return undefined;
    let active = true;
    let temporary: string | null = null;
    const extension = capture.mimeType === "image/png" ? "png" : "jpg";
    void decryptToTemporaryFile(
      capture.encryptedUri,
      extension,
      `capture:${capture.id}`,
    )
      .then(async (uri) => {
        if (!active) {
          await removeTemporaryFile(uri);
          return;
        }
        temporary = uri;
        setPreviewUri(uri);
      })
      .catch(() => {
        if (active) {
          console.warn("[STOMA3D_RESULT_PREVIEW_FAILED]");
          setPreviewError(
            "The protected image could not be opened on this device.",
          );
        }
      });
    return () => {
      active = false;
      void removeTemporaryFile(temporary);
    };
  }, [capture?.encryptedUri, capture?.id, capture?.mimeType, previewEpoch]);

  if (!capture)
    return (
      <Screen
        title="Result unavailable"
        action={
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
        }
      >
        <Card>
          <Text style={{ color: theme.text }}>
            This protected observation could not be found.
          </Text>
          <Button
            label="Back to scan"
            onPress={() => router.replace("/(tabs)/scan")}
          />
        </Card>
      </Screen>
    );

  const label =
    MOUTH_REGION_DETAILS.find((item) => item.id === capture.region)?.label ??
    capture.region;
  const complete = analysis?.status === "complete";
  const session = sessions.find((item) => item.id === capture.sessionId);
  const next = session ? nextScanCapture(session, captures) : null;
  const unavailable = !analysis || analysis.status === "failed";
  const statusTitle = analysisStatusTitle(
    analysis?.status,
    Boolean(analysis?.candidateMask),
  );
  const statusIcon: keyof typeof Ionicons.glyphMap =
    complete && analysis?.candidateMask
      ? "scan-outline"
      : complete
        ? "eye-off-outline"
        : analysis?.status === "abstained"
          ? "shield-outline"
          : analysis?.status === "unsupported"
            ? "ban-outline"
            : "cloud-offline-outline";
  const statusReasons = [
    ...new Set([
      ...(analysis?.abstentionReasons ?? []),
      ...(analysis?.quality.reasons ?? []),
      ...(analysis?.uncertainty.limitations ?? []),
    ]),
  ];
  const canRetry =
    capture.inputOrigin === "live_capture" &&
    Boolean(capture.encryptedUri) &&
    !complete;
  const qualityRejected = analysis?.quality.accepted === false;
  const explanationSteps = analysis
    ? [
        {
          id: "quality",
          title: "Image quality",
          summary: analysis.quality.accepted ? "Accepted" : "Not accepted",
          detail: analysis.quality.accepted
            ? "The server accepted blur, exposure, glare, obstruction, and privacy checks for this image."
            : `The image did not clear every quality check. ${analysis.quality.reasons.map(humanizeResultReason).join(" ") || "No additional reason was returned."}`,
        },
        {
          id: "anatomy",
          title: "Region match",
          summary:
            analysis.anatomyPrediction.supported &&
            analysis.anatomyPrediction.selectedRegionMatches
              ? "Matched"
              : "Not confirmed",
          detail:
            analysis.anatomyPrediction.supported &&
            analysis.anatomyPrediction.selectedRegionMatches
              ? `The anatomy model matched the selected ${label.toLowerCase()} region.`
              : "The selected mouth region was not confirmed, so the app does not treat this as a completed region result.",
        },
        {
          id: "candidate",
          title: "Candidate boundary",
          summary: analysis.candidateMask ? "Returned" : "Not returned",
          detail: analysis.candidateMask
            ? "A released segmentation model returned a candidate boundary. The visible measurements come from that boundary and remain approximate."
            : "No candidate boundary was returned for this image. Review the capture quality and region match for more context.",
        },
        {
          id: "intake",
          title: "Reported context",
          summary: sessionProfile ? "Saved with this scan" : "Not provided",
          detail: sessionProfile
            ? `Reported duration: ${sessionProfile.durationDays === undefined ? "not provided" : `${sessionProfile.durationDays} days`}. Reported symptoms: ${sessionProfile.symptoms.length ? sessionProfile.symptoms.join(", ") : "none"}. These answers provide context but do not change the image model output.`
            : "No symptom intake is linked to this scan. The image result is shown without filling in missing answers.",
        },
        {
          id: "follow-up",
          title: "Follow-up comparison",
          summary: relatedComparison?.comparable
            ? "Comparable"
            : "Not available",
          detail: relatedComparison?.comparable
            ? `A user-confirmed follow-up cleared the registration gates with ${Math.round(relatedComparison.registrationConfidence * 100)}% registration confidence.`
            : "No user-confirmed comparison linked to this observation has enough alignment evidence to report change.",
        },
        ...(isReleasedModelOutput(analysis.appearanceOutput) ||
        isReleasedModelOutput(analysis.diseaseResearchOutput)
          ? [
              {
                id: "additional-analysis",
                title: "Additional analysis",
                summary: "Available for this result",
                detail:
                  "Additional image-pattern details are shown separately with their confidence and deployed model version.",
              },
            ]
          : []),
        {
          id: "limitations",
          title: "Limits and uncertainty",
          summary: `${Math.round(analysis.uncertainty.overallConfidence * 100)}% overall model confidence`,
          detail: analysis.uncertainty.limitations.length
            ? analysis.uncertainty.limitations.join(" ")
            : "No additional model limitation text was returned. The standing limitation still applies: this result is not a diagnosis.",
        },
      ]
    : [];
  const symptomCompleteness = intakeCompleteness(sessionProfile);

  const retryAnalysis = async () => {
    if (!canRetry || !previewUri) return;
    setRetrying(true);
    setRetryError(null);
    setRetryNotice(null);
    try {
      const nextAnalysis = await analyzeCapture({
        captureId: capture.id,
        selectedRegion: capture.region,
        imageUri: previewUri,
        mimeType: capture.mimeType,
        inputOrigin: "live_capture",
        localQuality: capture.quality,
        ...(capture.calibrationRequested === true &&
        capture.calibrationCardVersion === "stoma3d-calibration-v1"
          ? {
              calibration: {
                cardVersion: capture.calibrationCardVersion,
                markerId: 17,
                markerSideMm: 20,
                planeConfirmed: capture.calibrationPlaneConfirmed === true,
              } as const,
            }
          : {}),
      });
      const disposition = captureAnalysisRetryDisposition(
        nextAnalysis,
        capture.region,
      );
      if (disposition === "preserve") {
        throw new Error(
          "Analysis could not be refreshed. Your saved photo and previous result are unchanged. Try again.",
        );
      }
      const rejectionReasons = captureStorageRejectionReasons(
        nextAnalysis,
        capture.region,
      );
      if (disposition === "reject") {
        await discardCapture(capture.id);
        setActiveSession(capture.sessionId);
        Alert.alert(
          "Retake required",
          `${rejectionReasons.join(" ")} The rejected protected image and any report containing it were removed.`,
        );
        router.replace({
          pathname: "/capture/[region]",
          params: { region: capture.region },
        });
        return;
      }
      await updateCaptureAnalysis(capture.id, nextAnalysis);
      setRetryNotice(
        nextAnalysis.status === "complete"
          ? "Analysis completed and the saved result was updated."
          : nextAnalysis.status === "abstained"
            ? "The service reviewed this image but abstained. No result was invented."
            : nextAnalysis.status === "unsupported"
              ? "The service still considers this image unsupported."
              : "Analysis is still unavailable. The protected image remains saved locally.",
      );
    } catch (error) {
      setRetryError(
        error instanceof Error
          ? error.message
          : "The saved image could not be analyzed again.",
      );
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Screen
      title="Your result"
      eyebrow={label}
      action={
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      }
    >
      <View>
        <SectionTitle
          title={statusTitle}
          subtitle={`${capture.inputOrigin === "bundled_demo" ? "Bundled synthetic input" : capture.captureSource === "photo_library" ? "Uploaded photo" : "Camera photo"} · ${new Date(capture.capturedAt).toLocaleDateString()}`}
          icon={statusIcon}
        />
      </View>
      {!complete &&
      analysis?.anatomyPrediction.supported &&
      analysis.anatomyPrediction.selectedRegionMatches ? (
        <Card accent="teal">
          <SectionTitle
            title="Mouth region confirmed"
            subtitle={`The live anatomy check matched ${label} with ${Math.round(analysis.anatomyPrediction.confidence * 100)}% model confidence.`}
            icon="checkmark-circle-outline"
          />
          <Text style={[styles.limitation, { color: theme.secondaryText }]}>
            This confirms only the selected photo region. It is not a finding
            about health or disease.
          </Text>
        </Card>
      ) : null}
      {analysis?.candidateMask ? (
        <>
          <MaskOverlay
            imageUri={previewUri}
            mask={analysis.candidateMask}
            showMask={showMask}
          />
          <Button
            label={showMask ? "Hide outline" : "Show outline"}
            variant="ghost"
            onPress={() => setShowMask((value) => !value)}
          />
        </>
      ) : previewUri ? (
        <Image
          accessible
          accessibilityLabel={`Saved ${label} observation without a candidate outline`}
          source={{ uri: previewUri }}
          resizeMode="contain"
          style={[styles.preview, { backgroundColor: theme.navy }]}
        />
      ) : (
        <View
          style={[
            styles.preview,
            styles.previewPlaceholder,
            { backgroundColor: theme.navy },
          ]}
        >
          <Text style={styles.previewPlaceholderText}>
            {previewError
              ? "Protected image preview unavailable"
              : capture.encryptedUri
                ? "Opening protected image…"
                : "No protected image is stored for this legacy observation."}
          </Text>
        </View>
      )}
      {previewError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: theme.danger }]}
        >
          {previewError}
        </Text>
      ) : null}
      {complete && analysis && !analysis.candidateMask ? (
        <Card accent="amber">
          <SectionTitle
            title="No candidate outline found"
            subtitle="The photo was analyzed. No area met the model’s outline threshold."
            icon="information-circle-outline"
          />
          <Text style={[styles.limitation, { color: theme.secondaryText }]}>
            If an area persists, changes, or worries you, show the photo to a
            dental professional.
          </Text>
        </Card>
      ) : null}
      {!complete ? (
        <Card accent={unavailable ? "coral" : "amber"}>
          <SectionTitle
            title="Analysis needs another try"
            icon="information-circle-outline"
          />
          {statusReasons.length ? (
            statusReasons.map((reason) => (
              <Text
                key={reason}
                style={[styles.limitation, { color: theme.secondaryText }]}
              >
                • {humanizeResultReason(reason)}
              </Text>
            ))
          ) : (
            <Text style={[styles.limitation, { color: theme.secondaryText }]}>
              No completed analysis response is stored for this observation.
            </Text>
          )}
          {canRetry ? (
            <>
              <Button
                label="Retry analysis"
                icon="refresh-outline"
                variant="secondary"
                loading={retrying}
                disabled={!previewUri}
                onPress={() => {
                  void retryAnalysis();
                }}
              />
              {!previewUri && !previewError ? (
                <Text
                  style={[styles.limitation, { color: theme.secondaryText }]}
                >
                  Opening the protected image before retry is available…
                </Text>
              ) : null}
            </>
          ) : null}
          {qualityRejected ? (
            <Button
              label="Retake this region"
              icon="camera-outline"
              variant="secondary"
              onPress={() => {
                setActiveSession(capture.sessionId);
                router.push({
                  pathname: "/capture/[region]",
                  params: { region: capture.region },
                });
              }}
            />
          ) : null}
          {retryNotice ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.notice, { color: theme.primary }]}
            >
              {retryNotice}
            </Text>
          ) : null}
          {retryError ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: theme.danger }]}
            >
              {retryError}
            </Text>
          ) : null}
        </Card>
      ) : null}
      {complete && analysis?.candidateMask ? (
        <Card accent={pinConfirmed ? "teal" : "amber"}>
          <SectionTitle
            title={
              pinConfirmed
                ? "Observation pin confirmed"
                : "Confirm map location"
            }
            subtitle="Confirm this area to add it to your map."
            icon={pinConfirmed ? "location" : "location-outline"}
          />
          {pinConfirmed ? (
            <Text style={[styles.limitation, { color: theme.secondaryText }]}>
              This observation is saved on your map.
            </Text>
          ) : (
            <Button
              label="Add observation to map"
              icon="location-outline"
              variant="secondary"
              onPress={() => confirmObservationPin(capture.id)}
            />
          )}
        </Card>
      ) : null}
      {detailsOpen && analysis?.candidateMask ? (
        <Card>
          <SectionTitle
            title="Observation identity card"
            subtitle="A plain-language record of this saved image and its confirmed links."
            icon="id-card-outline"
          />
          <View style={styles.grid}>
            <Descriptor label="Location" value={label} />
            <Descriptor
              label="First saved"
              value={new Date(capture.capturedAt).toLocaleDateString()}
            />
            <Descriptor
              label="Reported duration"
              value={
                sessionProfile?.durationDays === undefined
                  ? "Not provided"
                  : `${sessionProfile.durationDays} day${sessionProfile.durationDays === 1 ? "" : "s"}`
              }
            />
            <Descriptor
              label="Map status"
              value={
                observationPin
                  ? (
                      observationPin.comparisonStatus ?? observationPin.status
                    ).replaceAll("_", " ")
                  : "Not yet confirmed"
              }
            />
          </View>
          <Text style={[styles.limitation, { color: theme.secondaryText }]}>
            Reported symptoms:{" "}
            {sessionProfile?.symptoms.length
              ? sessionProfile.symptoms.join(", ")
              : "none provided"}
          </Text>
          <Text style={[styles.limitation, { color: theme.secondaryText }]}>
            Visible record: approximate area{" "}
            {(analysis.candidateMask.normalizedArea * 100).toFixed(1)}% of this
            image. This card does not identify a cause.
          </Text>
        </Card>
      ) : null}
      {analysis?.descriptors ? (
        <Card>
          <SectionTitle
            title="Visible characteristics"
            subtitle="Approximate measurements from this photo."
            icon="options-outline"
          />
          <View style={styles.grid}>
            <Descriptor
              label="Area"
              value={`${(analysis.descriptors.normalizedArea * 100).toFixed(1)}%`}
            />
            <Descriptor
              label="Border irregularity"
              value={analysis.descriptors.borderIrregularity.toFixed(2)}
            />
            <Descriptor
              label="Redness"
              value={`${Math.round(analysis.descriptors.meanRedness * 100)}%`}
            />
            <Descriptor
              label="Texture contrast"
              value={`${Math.round(analysis.descriptors.textureContrast * 100)}%`}
            />
          </View>
        </Card>
      ) : null}
      <Button
        label={detailsOpen ? "Hide details" : "Result details and follow-up"}
        variant="ghost"
        accessibilityState={{ expanded: detailsOpen }}
        onPress={() => setDetailsOpen((value) => !value)}
      />
      {detailsOpen ? (
        <>
          <Text style={[styles.provenance, { color: theme.secondaryText }]}>
            {analysisOriginCopy(analysis?.analysisOrigin)} · Capture{" "}
            {capture.id}
            {analysis
              ? ` · ${Object.entries(analysis.modelVersions)
                  .map(([name, version]) => `${name}: ${version}`)
                  .join(", ")}`
              : ""}
          </Text>
          {capture.calibrationRequested ? (
            <Card
              accent={
                capture.calibration?.status === "valid"
                  ? "teal"
                  : capture.calibration?.status === "invalid"
                    ? "amber"
                    : undefined
              }
            >
              <SectionTitle
                title={
                  capture.calibration?.status === "valid"
                    ? "Physical scale verified"
                    : capture.calibration?.status === "invalid"
                      ? "Physical scale could not be verified"
                      : "Physical scale check pending"
                }
                subtitle="Millimeter values are calibrated estimates, not clinical measurements."
                icon="resize-outline"
              />
              {capture.calibration?.status === "valid" ? (
                <View style={styles.grid}>
                  <Descriptor
                    label="Estimated width"
                    value={`${capture.calibration.estimatedWidthMm?.toFixed(1) ?? "—"} mm`}
                  />
                  <Descriptor
                    label="Estimated height"
                    value={`${capture.calibration.estimatedHeightMm?.toFixed(1) ?? "—"} mm`}
                  />
                  <Descriptor
                    label="Estimated area"
                    value={`${capture.calibration.estimatedAreaMm2?.toFixed(1) ?? "—"} mm²`}
                  />
                  <Descriptor
                    label="Scale confidence"
                    value={`${Math.round((capture.calibration.confidence ?? 0) * 100)}%`}
                  />
                </View>
              ) : (
                <Text
                  style={[styles.limitation, { color: theme.secondaryText }]}
                >
                  {capture.calibration?.gateReasons.length
                    ? capture.calibration.gateReasons
                        .map(humanizeResultReason)
                        .join(" ")
                    : "No millimeter value is stored until the versioned marker, same-plane placement, and candidate-boundary checks all pass."}
                </Text>
              )}
            </Card>
          ) : null}
          {complete && analysis ? (
            <>
              <Card>
                <SectionTitle
                  title="Why this result appears"
                  subtitle="Open each step to see exactly what evidence was used."
                  icon="git-branch-outline"
                />
                {explanationSteps.map((step, index) => (
                  <ExplanationStep
                    key={step.id}
                    index={index + 1}
                    title={step.title}
                    summary={step.summary}
                    detail={step.detail}
                    expanded={openExplanationStep === step.id}
                    onPress={() =>
                      setOpenExplanationStep((current) =>
                        current === step.id ? null : step.id,
                      )
                    }
                  />
                ))}
              </Card>
              <Card>
                <SectionTitle
                  title="Confidence constellation"
                  subtitle="Several factors are shown instead of one unexplained score."
                  icon="analytics-outline"
                />
                <ConfidenceFactor
                  label="Image quality"
                  value={analysis.uncertainty.imageQualityConfidence}
                />
                <ConfidenceFactor
                  label="Candidate visibility"
                  value={null}
                  unavailableReason="No separate candidate-visibility score has passed a release gate."
                />
                <ConfidenceFactor
                  label="Model agreement"
                  value={analysis.uncertainty.modelAgreement}
                  unavailableReason="No independent model ensemble has passed a release gate."
                />
                <ConfidenceFactor
                  label="Follow-up alignment"
                  value={
                    relatedComparison?.userConfirmedMatch &&
                    relatedComparison.comparable
                      ? relatedComparison.registrationConfidence
                      : null
                  }
                  unavailableReason="No user-confirmed comparable follow-up is linked to this observation."
                />
                <ConfidenceFactor
                  label="Symptom completeness"
                  value={symptomCompleteness}
                  unavailableReason="No saved symptom intake is linked to this scan."
                />
                <ConfidenceFactor
                  label="Dataset similarity"
                  value={analysis.uncertainty.datasetSimilarity}
                  unavailableReason="No released dataset-similarity model is installed."
                />
                {analysis.uncertainty.limitations.map((limitation) => (
                  <Text
                    key={limitation}
                    style={[styles.limitation, { color: theme.secondaryText }]}
                  >
                    • {limitation}
                  </Text>
                ))}
              </Card>
            </>
          ) : null}
          {complete &&
          analysis?.appearanceOutput?.enabled &&
          analysis.appearanceOutput.gatePassed ? (
            <Card>
              <SectionTitle
                title="Appearance descriptor"
                subtitle="Pixel pattern only; it does not identify a condition."
                icon="color-palette-outline"
              />
              <Text style={[styles.appearance, { color: theme.text }]}>
                {analysis.appearanceOutput.topLabel?.replaceAll("-", " ") ??
                  "Unsupported"}
              </Text>
              <Text style={[styles.limitation, { color: theme.secondaryText }]}>
                {analysis.appearanceOutput.limitation}
              </Text>
            </Card>
          ) : null}
          {complete &&
          isReleasedModelOutput(analysis?.diseaseResearchOutput) ? (
            <Card accent="amber">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  researchOpen
                    ? `Hide ${ADDITIONAL_ANALYSIS_TITLE.toLowerCase()}`
                    : `Show ${ADDITIONAL_ANALYSIS_TITLE.toLowerCase()}`
                }
                accessibilityState={{ expanded: researchOpen }}
                onPress={() => setResearchOpen((value) => !value)}
                style={({ pressed }) => [
                  styles.expand,
                  pressed && styles.expandPressed,
                ]}
              >
                <SectionTitle
                  title={ADDITIONAL_ANALYSIS_TITLE}
                  subtitle="Additional context with its confidence and model version."
                  icon="flask-outline"
                />
                <Ionicons
                  name={researchOpen ? "chevron-up" : "chevron-down"}
                  color={theme.secondaryText}
                  size={20}
                />
              </Pressable>
              {researchOpen ? (
                <Text
                  style={[styles.limitation, { color: theme.secondaryText }]}
                >
                  {`${analysis.diseaseResearchOutput.topLabel?.replaceAll("_", " ") ?? "No label"} · ${analysis.diseaseResearchOutput.limitation}`}
                </Text>
              ) : null}
            </Card>
          ) : null}
          <Card accent="amber">
            <SectionTitle
              title={
                guidance.enabled
                  ? guidance.reviewPriority === "professional_review_suggested"
                    ? "Professional review suggested"
                    : "Clinician-reviewed guidance"
                  : "When to seek advice"
              }
              icon="information-circle-outline"
            />
            {guidance.enabled ? (
              <Text style={[styles.limitation, { color: theme.text }]}>
                {guidance.statusMessage}
              </Text>
            ) : null}
            <Text style={[styles.limitation, { color: theme.secondaryText }]}>
              {guidance.message}
            </Text>
          </Card>
          <Card>
            <SectionTitle
              title={reminder.title}
              subtitle={reminder.description}
              icon="notifications-outline"
            />
            <Button
              label={`Remind me in ${reminder.delayDays === 1 ? "1 day" : "7 days"}`}
              icon="alarm-outline"
              variant="secondary"
              loading={reminderBusy}
              loadingLabel="Scheduling reminder..."
              onPress={() => {
                setReminderBusy(true);
                setReminderError(null);
                setReminderNotice(null);
                void scheduleObservationReminder({
                  captureId: capture.id,
                  suggestion: reminder,
                })
                  .then(({ scheduledFor }) => {
                    setReminderNotice(
                      `Reminder scheduled for ${scheduledFor.toLocaleString()}.`,
                    );
                  })
                  .catch((error: unknown) => {
                    setReminderError(
                      error instanceof Error
                        ? error.message
                        : "The reminder could not be scheduled.",
                    );
                  })
                  .finally(() => setReminderBusy(false));
              }}
            />
            {reminderNotice ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.notice, { color: theme.primary }]}
              >
                {reminderNotice}
              </Text>
            ) : null}
            {reminderError ? (
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: theme.danger }]}
              >
                {reminderError}
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}
      <Button
        label={next ? "Next region" : "Create report"}
        icon={next ? "arrow-forward" : "document-text-outline"}
        onPress={() => {
          setActiveSession(capture.sessionId);
          if (next)
            router.replace({ pathname: "/capture/[region]", params: next });
          else router.push("/report");
        }}
      />
      <Button
        label="View on 3D map"
        variant="secondary"
        icon="cube-outline"
        onPress={() =>
          router.push({
            pathname: "/(tabs)/map",
            params: { region: capture.region, captureId: capture.id },
          })
        }
      />
      <Text style={[styles.limitation, { color: theme.secondaryText }]}>
        {DISCLAIMER}
      </Text>
    </Screen>
  );
}

function Descriptor({ label, value }: { label: string; value: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.descriptor, { backgroundColor: theme.background }]}>
      <Text style={[styles.descriptorValue, { color: theme.primary }]}>
        {value}
      </Text>
      <Text style={[styles.descriptorLabel, { color: theme.secondaryText }]}>
        {label}
      </Text>
    </View>
  );
}

function ExplanationStep({
  index,
  title,
  summary,
  detail,
  expanded,
  onPress,
}: {
  index: number;
  title: string;
  summary: string;
  detail: string;
  expanded: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.treeStep, { borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${summary}`}
        accessibilityHint={
          expanded ? "Collapses this explanation" : "Expands this explanation"
        }
        accessibilityState={{ expanded }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.treeButton,
          pressed && styles.expandPressed,
        ]}
      >
        <View style={[styles.treeIndex, { backgroundColor: theme.mint }]}>
          <Text style={{ color: theme.primary, fontWeight: "900" }}>
            {index}
          </Text>
        </View>
        <View style={styles.treeCopy}>
          <Text style={[styles.treeTitle, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.treeSummary, { color: theme.secondaryText }]}>
            {summary}
          </Text>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          color={theme.secondaryText}
          size={20}
        />
      </Pressable>
      {expanded ? (
        <Text style={[styles.treeDetail, { color: theme.secondaryText }]}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

function ConfidenceFactor({
  label,
  value,
  unavailableReason = "This factor was not returned.",
}: {
  label: string;
  value: number | null;
  unavailableReason?: string;
}) {
  const theme = useAppTheme();
  if (value !== null) return <MetricBar label={label} value={value} />;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: not assessed. ${unavailableReason}`}
      style={[
        styles.unavailableFactor,
        { borderColor: theme.border, backgroundColor: theme.background },
      ]}
    >
      <Text style={[styles.unavailableFactorLabel, { color: theme.text }]}>
        {label}
      </Text>
      <View style={styles.unavailableFactorCopy}>
        <Text
          style={[
            styles.unavailableFactorValue,
            { color: theme.secondaryText },
          ]}
        >
          Not assessed
        </Text>
        <Text
          style={[
            styles.unavailableFactorReason,
            { color: theme.secondaryText },
          ]}
        >
          {unavailableReason}
        </Text>
      </View>
    </View>
  );
}

function intakeCompleteness(profile: IntakeProfile | null): number | null {
  if (!profile) return null;
  const answers = [
    Boolean(profile.ageRange),
    typeof profile.assisted === "boolean",
    profile.firstNoticed.trim().length > 0,
    profile.durationDays !== undefined,
    Array.isArray(profile.symptoms),
    Boolean(profile.change),
    Boolean(profile.tobaccoExposure),
    Boolean(profile.alcoholExposure),
    profile.previousConditions.trim().length > 0,
    typeof profile.professionallyExamined === "boolean",
  ];
  if (
    profile.symptoms.some(
      (symptom) => symptom.trim().toLowerCase() === "bleeding",
    )
  ) {
    answers.push(
      profile.bleedingFrequency !== undefined,
      Boolean(profile.bleedingDuration?.trim()),
    );
  }
  return answers.filter(Boolean).length / answers.length;
}

function analysisOriginCopy(
  origin:
    | "live_model"
    | "cached_model_result"
    | "manual_fixture"
    | "unavailable"
    | undefined,
): string {
  if (origin === "live_model") return "Live model response";
  if (origin === "cached_model_result") return "Hash-matched cached result";
  if (origin === "manual_fixture") return "Bundled demonstration result";
  return "Analysis unavailable";
}

const styles = StyleSheet.create({
  provenance: { fontSize: 12, lineHeight: 18 },
  preview: { width: "100%", minHeight: 260, borderRadius: 22 },
  previewPlaceholder: { alignItems: "center", justifyContent: "center" },
  previewPlaceholderText: { color: "#FFFFFF", fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  descriptor: { width: "48%", padding: 12, borderRadius: 14, gap: 3 },
  descriptorValue: {
    fontSize: 21,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  descriptorLabel: { fontSize: 11, fontWeight: "700" },
  limitation: { fontSize: 13, lineHeight: 19 },
  unavailableFactor: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  unavailableFactorLabel: { width: "38%", fontSize: 13, fontWeight: "800" },
  unavailableFactorCopy: { flex: 1, alignItems: "flex-end", gap: 2 },
  unavailableFactorValue: { fontSize: 13, fontWeight: "700" },
  unavailableFactorReason: { fontSize: 11, lineHeight: 15, textAlign: "right" },
  appearance: { fontSize: 23, fontWeight: "900", textTransform: "capitalize" },
  expand: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  expandPressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  treeStep: { borderBottomWidth: StyleSheet.hairlineWidth },
  treeButton: {
    minHeight: 52,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingVertical: 8,
  },
  treeIndex: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  treeCopy: { flex: 1, gap: 2 },
  treeTitle: { fontSize: 13, fontWeight: "800" },
  treeSummary: { fontSize: 12, lineHeight: 17 },
  treeDetail: {
    fontSize: 13,
    lineHeight: 19,
    paddingLeft: 38,
    paddingBottom: 12,
  },
  notice: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  error: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
});
