import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius } from "@/src/theme/colors";
import { api, Group } from "@/src/api/client";

export default function AdminGroups() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Group | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setGroups(await api.getGroups());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openAdd = () => {
    setEditing(null);
    setName("");
    setLogo("");
    setModalOpen(true);
  };

  const openEdit = (g: Group) => {
    setEditing(g);
    setName(g.name);
    setLogo(g.logo || "");
    setModalOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.updateGroup(editing.id, { name: name.trim(), logo });
      } else {
        await api.createGroup({ name: name.trim(), logo, order: groups.length });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: Group) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await api.deleteGroup(g.id);
    load();
  };

  const renderItem = ({ item }: { item: Group }) => (
    <Pressable
      testID={`admin-group-${item.id}`}
      style={styles.row}
      onPress={() =>
        router.push({
          pathname: "/admin/channels",
          params: { groupId: item.id, groupName: item.name },
        })
      }
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.name}</Text>
        <Text style={styles.rowSub}>اضغط لإدارة القنوات</Text>
      </View>
      <Pressable testID={`edit-group-${item.id}`} hitSlop={10} style={styles.iconBtn} onPress={() => openEdit(item)}>
        <Ionicons name="create-outline" size={22} color={colors.onSurfaceSecondary} />
      </Pressable>
      <Pressable testID={`delete-group-${item.id}`} hitSlop={10} style={styles.iconBtn} onPress={() => remove(item)}>
        <Ionicons name="trash-outline" size={22} color={colors.error} />
      </Pressable>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="admin-back" hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-forward" size={26} color={colors.onBrandPrimary} />
        </Pressable>
        <Text style={styles.title}>لوحة التحكم — المجموعات</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : (
        <FlatList
          testID="admin-groups-list"
          data={groups}
          keyExtractor={(g) => g.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 90 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.rowSub}>لا توجد مجموعات. أضف مجموعة جديدة.</Text>
            </View>
          }
        />
      )}

      <Pressable
        testID="add-group-fab"
        style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
        onPress={openAdd}
      >
        <Ionicons name="add" size={26} color="#fff" />
        <Text style={styles.fabText}>مجموعة</Text>
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing ? "تعديل مجموعة" : "مجموعة جديدة"}</Text>
            <TextInput
              testID="group-name-input"
              style={styles.input}
              placeholder="اسم المجموعة"
              placeholderTextColor={colors.onSurfaceTertiary}
              value={name}
              onChangeText={setName}
            />
            <TextInput
              testID="group-logo-input"
              style={styles.input}
              placeholder="رابط الشعار (اختياري)"
              placeholderTextColor={colors.onSurfaceTertiary}
              value={logo}
              onChangeText={setLogo}
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.mBtn, styles.mBtnGhost]} onPress={() => setModalOpen(false)}>
                <Text style={styles.mBtnGhostText}>إلغاء</Text>
              </Pressable>
              <Pressable testID="save-group-button" style={[styles.mBtn, styles.mBtnPrimary]} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.mBtnPrimaryText}>حفظ</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
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
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: colors.onBrandPrimary, fontSize: 17, fontWeight: "800", flex: 1, textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: spacing["3xl"] },
  row: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700", textAlign: "right" },
  rowSub: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: "right", marginTop: 2 },
  iconBtn: { padding: spacing.xs },
  fab: {
    position: "absolute",
    left: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  fabText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800", textAlign: "right" },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontSize: 15,
    textAlign: "right",
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalActions: { flexDirection: "row-reverse", gap: spacing.md, marginTop: spacing.sm },
  mBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center" },
  mBtnPrimary: { backgroundColor: colors.brand },
  mBtnPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  mBtnGhost: { backgroundColor: colors.surfaceTertiary },
  mBtnGhostText: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 15 },
});
