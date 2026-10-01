import { useRef, useState } from "react";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { DISCLAIMER } from "@/constants";
import { Screen } from "@/components/Screen";
import { Button, ChoiceChip } from "@/components/Ui";
import { IntakeExtraDetails } from "@/components/IntakeExtraDetails";
import { intakeProfileForScan } from "@/lib/usabilityFlow";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme } from "@/theme";
import type { IntakeProfile } from "@/types";

const symptomOptions = [
  "pain",
  "bleeding",
  "numbness",
  "difficulty swallowing",
  "jaw pain",
  "neck lump",
  "ear pain",
];
const changeOptions = [
  ["not_sure", "Not sure"],
  ["no_change", "No change"],
  ["slow_change", "Slowly"],
  ["rapid_change", "Quickly"],
] as const;

export default function OnboardingRoute() {
  const theme = useAppTheme();
  const consentedAt = useStoma3DStore((state) => state.consentedAt);
  const finishConsentAndStartSession = useStoma3DStore(
    (state) => state.finishConsentAndStartSession,
  );
  const [step, setStep] = useState(consentedAt ? 1 : 0);
  const [consent, setConsent] = useState(Boolean(consentedAt));
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [firstNoticed, setFirstNoticed] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [change, setChange] = useState<IntakeProfile["change"]>("not_sure");
  const [extra, setExtra] = useState<Partial<IntakeProfile>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const finish = async () => {
    if (!consent || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const profile = intakeProfileForScan({
        symptoms,
        firstNoticed,
        durationDays,
        change,
        extra,
      });
      await finishConsentAndStartSession(profile, "standard_eight_region");
      router.replace({
        pathname: "/capture/[region]",
        params: { region: "dorsal_tongue", angle: "primary" },
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Your answers could not be saved. Please try again.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const next = () => {
    setError(null);
    if (step === 0) setStep(1);
    else if (symptoms.length) setStep(2);
    else void finish();
  };
  return (
    <Screen
      title={
        step === 0
          ? "Before your first scan"
          : step === 1
            ? "How does your mouth feel?"
            : "A little more context"
      }
      action={
        <Button
          label="Close"
          variant="ghost"
          disabled={saving}
          onPress={() => router.replace("/(tabs)/home")}
        />
      }
    >
      <Text style={[styles.step, { color: theme.secondaryText }]}>
        {step === 0
          ? "About your scan"
          : step === 1
            ? "Symptoms"
            : "Duration and change"}
      </Text>
      {step === 0 ? (
        <View style={styles.section}>
          <Text style={[styles.body, { color: theme.text }]}>
            You’ll photograph eight mouth regions. Stoma3D checks each photo and
            shows visible areas to review on your oral map.
          </Text>
          <Text style={[styles.body, { color: theme.secondaryText }]}>
            Photos are saved encrypted on this device. A mouth-only copy is sent
            to the analysis service when you choose Use photo. You can delete
            your scans in Settings.
          </Text>
          <Text style={[styles.disclaimer, { color: theme.text }]}>
            {DISCLAIMER}
          </Text>
          <ChoiceChip
            label="I understand and agree to save and analyze my photos"
            selected={consent}
            accessibilityRole="checkbox"
            fullWidth
            onPress={() => setConsent((value) => !value)}
          />
        </View>
      ) : step === 1 ? (
        <View style={styles.section}>
          <Text style={[styles.body, { color: theme.secondaryText }]}>
            Select anything you’ve noticed. These answers go in your report.
          </Text>
          <ChoiceChip
            label="No symptoms"
            selected={symptoms.length === 0}
            accessibilityRole="checkbox"
            fullWidth
            onPress={() => setSymptoms([])}
          />
          {symptomOptions.map((symptom) => (
            <ChoiceChip
              key={symptom}
              label={symptom.charAt(0).toUpperCase() + symptom.slice(1)}
              selected={symptoms.includes(symptom)}
              accessibilityRole="checkbox"
              fullWidth
              onPress={() =>
                setSymptoms((current) =>
                  current.includes(symptom)
                    ? current.filter((item) => item !== symptom)
                    : [...current, symptom],
                )
              }
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsOpen }}
            onPress={() => setDetailsOpen((value) => !value)}
            style={styles.detailsToggle}
          >
            <Text style={[styles.link, { color: theme.primary }]}>
              {detailsOpen ? "Hide optional details" : "Add optional details"}
            </Text>
          </Pressable>
          {detailsOpen ? (
            <IntakeExtraDetails
              value={extra}
              onChange={setExtra}
              symptoms={symptoms}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.text }]}>
            When did you first notice it?
          </Text>
          <TextInput
            accessibilityLabel="When you first noticed symptoms"
            value={firstNoticed}
            onChangeText={setFirstNoticed}
            placeholder="For example, last week"
            placeholderTextColor={theme.secondaryText}
            maxLength={500}
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.surface,
              },
            ]}
          />
          <ChoiceChip
            label="Not sure"
            selected={firstNoticed === "Not sure"}
            onPress={() => {
              setFirstNoticed("Not sure");
              setDurationDays("");
            }}
          />
          <Text style={[styles.label, { color: theme.text }]}>
            Number of days, if you know
          </Text>
          <TextInput
            accessibilityLabel="Approximate duration in days, optional"
            value={durationDays}
            onChangeText={(value) =>
              setDurationDays(value.replaceAll(/\D/g, "").slice(0, 5))
            }
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="Optional"
            placeholderTextColor={theme.secondaryText}
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.surface,
              },
            ]}
          />
          <Text style={[styles.label, { color: theme.text }]}>
            Has it changed?
          </Text>
          <View accessibilityRole="radiogroup" style={styles.section}>
            {changeOptions.map(([value, label]) => (
              <ChoiceChip
                key={value}
                label={label}
                selected={change === value}
                accessibilityRole="radio"
                fullWidth
                onPress={() => setChange(value)}
              />
            ))}
          </View>
        </View>
      )}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.body, { color: theme.danger }]}
        >
          {error}
        </Text>
      ) : null}
      <Button
        label={
          step === 0 || (step === 1 && symptoms.length > 0)
            ? "Continue"
            : "Start scan"
        }
        icon="arrow-forward"
        disabled={!consent || saving}
        loading={saving}
        loadingLabel="Saving answers…"
        onPress={
          step === 2
            ? () => {
                void finish();
              }
            : next
        }
      />
      {step > (consentedAt ? 1 : 0) ? (
        <Button
          label="Back"
          variant="ghost"
          disabled={saving}
          onPress={() => setStep((value) => value - 1)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { fontSize: 13, marginTop: -8 },
  section: { gap: 12 },
  body: { fontSize: 15, lineHeight: 23 },
  disclaimer: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    paddingVertical: 8,
  },
  label: { fontSize: 16, fontWeight: "700", marginTop: 8 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  detailsToggle: { minHeight: 48, justifyContent: "center" },
  link: { fontSize: 14, fontWeight: "600" },
});
