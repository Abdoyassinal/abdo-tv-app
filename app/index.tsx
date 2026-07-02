import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Modal,
  TextInput,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius } from "@/src/theme/colors";
import { api, Group } from "@/src/api/client";

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const [pwModal, setPwModal] = useState(false);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [checking, setChecking] = useState(false);

  const tapCount = useRef(0);
  const lastTap = useRef(0);

  const load = useCallback(async () => {
    try {
      setError(false);
      const data = await api.getGroups();
      setGroups(data);
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onTitlePress = () => {
    const now = Date.now();
    // reset counter if more than 2s since last tap
    if (now - lastTap.current > 2000) {
      tapCount.current = 0;
    }
    lastTap.current = now;
    tapCount.current += 1;

    if (tapCount.current >= 7) {
      tapCount.current = 0;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setPassword("");
      setPwError("");
      setPwModal(true);
    } else {
      Haptics.selectionAsync();
    }
  };

  const submitPassword = async () => {
    setChecking(true);
    setPwError("");
    try {
      await api.adminLogin(password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPwModal(false);
      router.push("/admin");
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPwError(e.message || "كلمة السر غير صحيحة");
    } finally {
      setChecking(false);
    }
  };

  const renderGroup = ({ item, index }: { item: Group; index: number }) => (
    <Pressable
      testID={`group-card-${item.id}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/group/[id]", params: { id: item.id, name: item.name } });
      }}
    >
      <View style={styles.cardAccent} />
      <Text style={styles.cardText} numberOfLines={1}>
        {item.name}
      </Text>
      <Ionicons name="chevron-back" size={22} color={colors.brand} />
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="search-button" hitSlop={12}>
          <Ionicons name="search" size={24} color={colors.onBrandPrimary} />
        </Pressable>
        <Pressable
          testID="app-title"
          onPress={onTitlePress}
          hitSlop={12}
        >
          <Text style={styles.title}>abdo tv</Text>
        </Pressable>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyText}>فشل تحميل المجموعات</Text>
          <Pressable testID="retry-button" style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="tv-outline" size={48} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyText}>لا توجد مجموعات بعد</Text>
        </View>
      ) : (
        <FlatList
          testID="groups-list"
          data={groups}
          keyExtractor={(g) => g.id}
          renderItem={renderGroup}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.brand}
            />
          }
        />
      )}

      {/* Hidden admin password modal */}
      <Modal visible={pwModal} transparent animationType="fade" onRequestClose={() => setPwModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setPwModal(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Ionicons name="lock-closed" size={32} color={colors.brand} />
            <Text style={styles.modalTitle}>لوحة التحكم</Text>
            <Text style={styles.modalSub}>أدخل كلمة السر للمتابعة</Text>
            <TextInput
              testID="admin-password-input"
              style={styles.pwInput}
              placeholder="كلمة السر"
              placeholderTextColor={colors.onSurfaceTertiary}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoFocus
              onSubmitEditing={submitPassword}
            />
            {pwError ? <Text style={styles.pwErrorText}>{pwError}</Text> : null}
            <Pressable
              testID="admin-login-submit"
              style={styles.modalBtn}
              onPress={submitPassword}
              disabled={checking}
            >
              {checking ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Text style={styles.modalBtnText}>دخول</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: colors.onBrandPrimary, fontSize: 22, fontWeight: "800", letterSpacing: 0.5 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 16 },
  retryBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  retryText: { color: colors.onBrandPrimary, fontWeight: "700" },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  cardPressed: { opacity: 0.7, borderColor: colors.brand },
  cardAccent: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: colors.brand,
  },
  cardText: { color: colors.onSurface, fontSize: 17, fontWeight: "700", flex: 1, textAlign: "right" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: "100%",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "800", marginTop: spacing.sm },
  modalSub: { color: colors.onSurfaceTertiary, fontSize: 14, marginBottom: spacing.md },
  pwInput: {
    width: "100%",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontSize: 16,
    textAlign: "right",
    borderWidth: 1,
    borderColor: colors.border,
  },
  pwErrorText: { color: colors.error, fontSize: 13, marginTop: spacing.xs },
  modalBtn: {
    width: "100%",
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  modalBtnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "800" },
});
