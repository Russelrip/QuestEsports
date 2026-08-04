import { Ionicons } from "@expo/vector-icons";
import { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, humanize, radius, spacing, statusColors } from "@/theme";

export function Screen({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    children
  );
  return <SafeAreaView style={styles.screen} edges={["top", "bottom", "left", "right"]}>{content}</SafeAreaView>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.eyebrow}>QUEST ADMIN</Text>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  return (
    <View style={styles.fieldWrap}>
      {props.label ? <Text style={styles.fieldLabel}>{props.label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        {...props}
        style={[styles.field, props.multiline && styles.multilineField, props.style]}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  loading,
  disabled,
  tone = "primary",
  icon,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger" | "ghost";
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${tone}`],
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.white} /> : null}
      {!loading && icon ? <Ionicons name={icon} size={18} color={tone === "ghost" ? colors.accent : colors.white} /> : null}
      <Text style={[styles.buttonText, tone === "ghost" && styles.buttonGhostText]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

export function StatusBadge({ value }: { value?: string | null }) {
  const key = String(value || "unknown").toLowerCase();
  const color = statusColors[key] || colors.muted;
  return (
    <View style={[styles.badge, { borderColor: `${color}88`, backgroundColor: `${color}18` }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{humanize(key)}</Text>
    </View>
  );
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  if (!onPress) return <View style={styles.card}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      {children}
    </Pressable>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name="file-tray-outline" size={36} color={colors.muted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </View>
  );
}

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <View style={styles.errorNotice}>
      <Ionicons name="warning-outline" size={20} color={colors.danger} />
      <Text style={styles.errorText}>{message}</Text>
      {retry ? <Button label="Retry" tone="ghost" onPress={retry} /> : null}
    </View>
  );
}

export function FilterPills({
  values,
  selected,
  onSelect,
}: {
  values: Array<{ label: string; value: string }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      {values.map((item) => (
        <Pressable
          key={item.value}
          onPress={() => onSelect(item.value)}
          style={[styles.filter, selected === item.value && styles.filterSelected]}
        >
          <Text style={[styles.filterText, selected === item.value && styles.filterTextSelected]}>{item.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: 48, gap: spacing.md },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerText: { flex: 1 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1.8 },
  title: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 3 },
  fieldWrap: { gap: spacing.xs },
  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  field: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 14, fontSize: 16 },
  multilineField: { minHeight: 92, textAlignVertical: "top", paddingTop: 13 },
  button: { minHeight: 46, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.sm },
  button_primary: { backgroundColor: colors.accentStrong },
  button_secondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  button_danger: { backgroundColor: "#991b1b" },
  button_ghost: { backgroundColor: "transparent" },
  buttonText: { color: colors.white, fontWeight: "800", fontSize: 14 },
  buttonGhostText: { color: colors.accent },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
  iconButton: { height: 44, width: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: "800" },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardPressed: { backgroundColor: colors.surfaceRaised, transform: [{ scale: 0.995 }] },
  empty: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  emptyMessage: { color: colors.muted, textAlign: "center" },
  errorNotice: { margin: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: "#7f1d1d", backgroundColor: "#2b1116", padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  errorText: { color: "#fecaca", flex: 1 },
  filters: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.sm },
  filter: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: colors.surface },
  filterSelected: { backgroundColor: colors.accentStrong, borderColor: colors.accent },
  filterText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
  filterTextSelected: { color: colors.white },
});
