// components/ride/SayItYourWay.tsx
// The free-text field shared by Log moto, Adjust, Today's setup and Retune:
// the rider's own words go to the engine as feedback.free_text (an existing
// Tune Two input, parsed server-side). Voice arrives with a native build.
import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { interFont, V3 } from "../v3/theme";

export function SayItYourWay({
  value,
  onChangeText,
  placeholder = "Say it your way (optional). Voice arrives with the next update.",
  onSubmitEditing,
  style,
  autoFocus,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  onSubmitEditing?: () => void;
  style?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
}) {
  return (
    <View style={[styles.row, style]}>
      <Ionicons name="create-outline" size={18} color={V3.steel} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={V3.steel}
        style={[styles.input, interFont(400)]}
        multiline
        maxLength={400}
        blurOnSubmit
        returnKeyType="done"
        onSubmitEditing={onSubmitEditing}
        autoFocus={autoFocus}
        accessibilityLabel="Say it your way"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10 },
  input: { flex: 1, color: "#FFFFFF", fontSize: 14, minHeight: 40, paddingTop: 0 },
});
