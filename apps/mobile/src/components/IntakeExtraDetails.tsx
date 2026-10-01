import { StyleSheet, Text, TextInput, View } from "react-native";
import { ChoiceChip } from "./Ui";
import { useAppTheme } from "@/theme";
import type { IntakeProfile } from "@/types";

export function IntakeExtraDetails({
  value,
  onChange,
  symptoms,
}: {
  value: Partial<IntakeProfile>;
  onChange: (value: Partial<IntakeProfile>) => void;
  symptoms: readonly string[];
}) {
  const theme = useAppTheme();
  const update = (next: Partial<IntakeProfile>) =>
    onChange({ ...value, ...next });
  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: theme.text }]}>Age range</Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {(
          [
            ["under_18", "Under 18"],
            ["18_39", "18–39"],
            ["40_64", "40–64"],
            ["65_plus", "65+"],
            ["prefer_not_to_say", "Prefer not to say"],
          ] as const
        ).map(([ageRange, label]) => (
          <ChoiceChip
            key={ageRange}
            label={label}
            selected={(value.ageRange ?? "prefer_not_to_say") === ageRange}
            accessibilityRole="radio"
            onPress={() => update({ ageRange })}
          />
        ))}
      </View>
      <ChoiceChip
        label="I’m helping someone else"
        selected={value.assisted ?? false}
        accessibilityRole="checkbox"
        fullWidth
        onPress={() => update({ assisted: !value.assisted })}
      />
      <Text style={[styles.label, { color: theme.text }]}>
        Tobacco exposure
      </Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {(
          [
            ["none", "None"],
            ["past", "Past"],
            ["current", "Current"],
            ["prefer_not_to_say", "Prefer not to say"],
          ] as const
        ).map(([tobaccoExposure, label]) => (
          <ChoiceChip
            key={tobaccoExposure}
            label={label}
            selected={
              (value.tobaccoExposure ?? "prefer_not_to_say") === tobaccoExposure
            }
            accessibilityRole="radio"
            onPress={() => update({ tobaccoExposure })}
          />
        ))}
      </View>
      <Text style={[styles.label, { color: theme.text }]}>
        Alcohol exposure
      </Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {(
          [
            ["none", "None"],
            ["some", "Some"],
            ["frequent", "Frequent"],
            ["prefer_not_to_say", "Prefer not to say"],
          ] as const
        ).map(([alcoholExposure, label]) => (
          <ChoiceChip
            key={alcoholExposure}
            label={label}
            selected={
              (value.alcoholExposure ?? "prefer_not_to_say") === alcoholExposure
            }
            accessibilityRole="radio"
            onPress={() => update({ alcoholExposure })}
          />
        ))}
      </View>
      {symptoms.includes("bleeding") ? (
        <>
          <Text style={[styles.label, { color: theme.text }]}>
            How often does bleeding happen?
          </Text>
          <View accessibilityRole="radiogroup" style={styles.options}>
            {(["once", "occasionally", "often"] as const).map(
              (bleedingFrequency) => (
                <ChoiceChip
                  key={bleedingFrequency}
                  label={bleedingFrequency}
                  selected={value.bleedingFrequency === bleedingFrequency}
                  accessibilityRole="radio"
                  onPress={() => update({ bleedingFrequency })}
                />
              ),
            )}
          </View>
          <TextInput
            accessibilityLabel="How long bleeding has occurred, optional"
            value={value.bleedingDuration ?? ""}
            onChangeText={(bleedingDuration) => update({ bleedingDuration })}
            placeholder="How long? (optional)"
            placeholderTextColor={theme.secondaryText}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border },
            ]}
          />
        </>
      ) : null}
      <TextInput
        accessibilityLabel="Previous oral conditions, optional"
        value={value.previousConditions ?? ""}
        onChangeText={(previousConditions) => update({ previousConditions })}
        placeholder="Previous oral conditions (optional)"
        placeholderTextColor={theme.secondaryText}
        multiline
        maxLength={2000}
        style={[styles.input, { color: theme.text, borderColor: theme.border }]}
      />
      <ChoiceChip
        label="Already examined by a professional"
        selected={value.professionallyExamined ?? false}
        accessibilityRole="checkbox"
        fullWidth
        onPress={() =>
          update({ professionallyExamined: !value.professionallyExamined })
        }
      />
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: 12 },
  label: { fontSize: 15, fontWeight: "700", marginTop: 12 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: {
    minHeight: 50,
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
    fontSize: 15,
  },
});
