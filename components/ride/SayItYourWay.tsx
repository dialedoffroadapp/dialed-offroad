// components/ride/SayItYourWay.tsx
// The free-text field shared by Log moto, Adjust, Today's setup and Retune:
// the rider's own words go to the engine as feedback.free_text (an existing
// Tune Two input, parsed server-side). Voice arrives with a native build.
import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { interFont, V3 } from "../v3/theme";

export function SayItYourWay({
  value,
  onChangeText,
  placeholder = "Say it your way (optional). Voice arrives with the next update.",
  onSubmitEditing,
  style,
  autoFocus,
  boxed,
  note,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  onSubmitEditing?: () => void;
  style?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
  /** A visible multi-line box (the refine screen) instead of the one-line row. */
  boxed?: boolean;
  /** A small line under the field (the voice note on the refine screen). */
  note?: string;
}) {
  return (
    <View style={style}>
      <View style={boxed ? styles.box : styles.row}>
        {boxed ? null : <Ionicons name="create-outline" size={18} color={V3.steel} />}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={V3.steel}
          style={[styles.input, boxed && styles.inputBoxed, interFont(400)]}
          multiline
          maxLength={400}
          blurOnSubmit
          returnKeyType="done"
          onSubmitEditing={onSubmitEditing}
          autoFocus={autoFocus}
          accessibilityLabel="Say it your way"
          testID="say-it-your-way"
        />
      </View>
      {note ? <Text style={[styles.note, interFont(400)]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10 },
  box: { borderWidth: 1, borderColor: V3.line, backgroundColor: V3.panel, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  input: { flex: 1, color: "#FFFFFF", fontSize: 14, minHeight: 40, paddingTop: 0 },
  inputBoxed: { minHeight: 88, fontSize: 15, lineHeight: 21, textAlignVertical: "top" },
  note: { color: V3.steel, fontSize: 12, marginTop: 6 },
});
