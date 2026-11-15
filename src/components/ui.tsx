import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C, R } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.scroll, style]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  small,
  style,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const fg = variant === 'primary' || variant === 'danger' ? '#fff' : variant === 'ghost' ? C.primary : C.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        variant === 'primary' && { backgroundColor: pressed ? C.primaryDark : C.primary },
        variant === 'secondary' && { backgroundColor: pressed ? '#E9ECF0' : C.card, borderWidth: 1, borderColor: C.border },
        variant === 'danger' && { backgroundColor: pressed ? '#B53A3A' : C.danger },
        variant === 'ghost' && { backgroundColor: pressed ? C.primarySoft : 'transparent' },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <Text style={[styles.btnText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color = C.text, style, testID }: { icon: IconName; onPress: () => void; label: string; color?: string; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: '#0000000D' }, style]}
    >
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Text style={[styles.h, style as object]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#98A2B3" {...props} style={[styles.input, props.multiline && { minHeight: 72, textAlignVertical: 'top' }, props.editable === false && { backgroundColor: '#F2F4F7', color: C.muted }, props.style]} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; color?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.seg}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled }}
              disabled={disabled}
              onPress={() => onChange(o.value)}
              style={[styles.segItem, on && { backgroundColor: o.color ?? C.primary }, disabled && !on && { opacity: 0.5 }]}
            >
              <Text style={[styles.segText, on && { color: '#fff' }]} numberOfLines={1}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Toggle({ label, value, onChange, hint, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: C.primary, false: '#D0D5DD' }} />
    </View>
  );
}

export function Badge({ text, color, soft }: { text: string; color: string; soft?: boolean }) {
  return (
    <View style={[styles.badge, { backgroundColor: soft ? color + '22' : color }]}>
      <Text style={[styles.badgeText, { color: soft ? color : '#fff' }]}>{text}</Text>
    </View>
  );
}

export function Banner({ text, tone = 'info', icon }: { text: string; tone?: 'info' | 'warn' | 'danger'; icon?: IconName }) {
  const bg = tone === 'warn' ? C.warnSoft : tone === 'danger' ? C.dangerSoft : C.primarySoft;
  const fg = tone === 'warn' ? '#8A6100' : tone === 'danger' ? C.danger : C.primaryDark;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Ionicons name={icon ?? (tone === 'info' ? 'information-circle' : 'warning')} size={18} color={fg} />
      <Text style={[styles.bannerText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Loading({ text }: { text?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={C.primary} />
      {text ? <Muted style={{ marginTop: 12 }}>{text}</Muted> : null}
    </View>
  );
}

/** Cross-platform confirm dialog (Alert is not available in browsers). */
export function confirm(title: string, message: string, okText = 'OK', destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: okText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}

export function alertMsg(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/** A small modal asking for one line of text (Alert.prompt is iOS-only). */
export function PromptModal({
  visible,
  title,
  message,
  initial = '',
  okText = 'OK',
  onSubmit,
  onCancel,
  placeholder,
}: {
  visible: boolean;
  title: string;
  message?: string;
  initial?: string;
  okText?: string;
  placeholder?: string;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [lastVisible, setLastVisible] = useState(false);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) setV(initial);
  }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBg}>
        <View style={styles.modalCard}>
          <Text style={styles.h}>{title}</Text>
          {message ? <Muted style={{ marginBottom: 12 }}>{message}</Muted> : null}
          <TextInput
            autoFocus
            value={v}
            onChangeText={setV}
            placeholder={placeholder}
            placeholderTextColor="#98A2B3"
            style={styles.input}
            autoCapitalize="characters"
            onSubmitEditing={() => v.trim() && onSubmit(v.trim())}
            testID="prompt-input"
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button title="Cancel" variant="secondary" small onPress={onCancel} />
            <Button title={okText} small disabled={!v.trim()} onPress={() => onSubmit(v.trim())} testID="prompt-ok" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} selectable>
        {value || '-'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, paddingHorizontal: 18, borderRadius: R.md, minHeight: 48 },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12, minHeight: 38, borderRadius: R.sm },
  btnText: { fontSize: 16, fontWeight: '600' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 16, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  h: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 8 },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  hint: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 17 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: C.text, backgroundColor: '#fff' },
  seg: { flexDirection: 'row', backgroundColor: '#EEF1F4', borderRadius: R.sm, padding: 3, gap: 3 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 6, alignItems: 'center' },
  segText: { fontSize: 14, fontWeight: '600', color: C.text },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  toggleLabel: { fontSize: 15, color: C.text, fontWeight: '500' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  banner: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: R.md, marginBottom: 12, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: R.lg, padding: 20, maxWidth: 420, width: '100%', alignSelf: 'center' },
  infoRow: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  infoLabel: { width: 120, color: C.muted, fontSize: 14 },
  infoValue: { flex: 1, color: C.text, fontSize: 14, fontWeight: '500' },
});
