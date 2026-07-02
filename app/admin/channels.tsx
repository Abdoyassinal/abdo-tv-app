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
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius } from "@/src/theme/colors";
import { api, Channel, Stream } from "@/src/api/client";

const STREAM_TYPES = ["auto", "hls", "dash", "ts", "progressive"];

function emptyStream(): Stream {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: "",
    url: "",
    type: "auto",
    user_agent: "",
    referer: "",
  };
}

export default function AdminChannels() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { groupId, groupName } = useLocalSearchParams<{ groupId: string; groupName: string }>();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [streams, setStreams] = useState<Stream[]>([]);

  const load = useCallback(async () => {
    try {
      setChannels(await api.getChannels(groupId));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openAdd = () => {
    setEditing(null);
    setName("");
    setLogo("");
    setStreams([emptyStream()]);
    setModalOpen(true);
  };

  const openEdit = (ch: Channel) => {
    setEditing(ch);
    setName(ch.name);
    setLogo(ch.logo || "");
    setStreams(ch.streams.length ? ch.streams : [emptyStream()]);
    setModalOpen(true);
  };

  const updateStream = (idx: number, patch: Partial<Stream>) => {
    setStreams((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addStream = () => setStreams((prev) => [...prev, emptyStream()]);
  const removeStream = (idx: number) => setStreams((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (!name.trim()) return;
    const validStreams = streams
      .filter((s) => s.url.trim())
      .map((s, i) => ({ ...s, label: s.label.trim() || `رابط ${i + 1}`, url: s.url.trim() }));
    setSaving(true);
    try {
      if (editing) {
        await api.updateChannel(editing.id, { name: name.trim(), logo, streams: validStreams });
      } else {
        await api.createChannel({
          group_id: groupId,
          name: name.trim(),
          logo,
          order: channels.length,
          streams: validStreams,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await api.deleteChannel(ch.id);
    load();
  };

  const renderItem = ({ item }: { item: Channel }) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.name}</Text>
        <Text style={styles.rowSub}>{item.streams.length} رابط</Text>
      </View>
      <Pressable testID={`edit-channel-${item.id}`} hitSlop={10} style={styles.iconBtn} onPress={() => openEdit(item)}>
        <Ionicons name="create-outline" size={22} color={colors.onSurfaceSecondary} />
      </Pressable>
      <Pressable testID={`delete-channel-${item.id}`} hitSlop={10} style={styles.iconBtn} onPress={() => remove(item)}>
        <Ionicons name="trash-outline" size={22} color={colors.error} />
      </Pressable>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="channels-back" hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-forward" size={26} color={colors.onBrandPrimary} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {groupName || "القنوات"}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : (
        <FlatList
          testID="admin-channels-list"
          data={channels}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 90 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.rowSub}>لا توجد قنوات. أضف قناة جديدة.</Text>
            </View>
          }
        />
      )}

      <Pressable
        testID="add-channel-fab"
        style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
        onPress={openAdd}
      >
        <Ionicons name="add" size={26} color="#fff" />
        <Text style={styles.fabText}>قناة</Text>
      </Pressable>

      <Modal visible={modalOpen} animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.editorContainer}>
          <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable testID="close-editor" hitSlop={12} onPress={() => setModalOpen(false)}>
              <Ionicons name="close" size={26} color={colors.onBrandPrimary} />
            </Pressable>
            <Text style={styles.title}>{editing ? "تعديل قناة" : "قناة جديدة"}</Text>
            <View style={{ width: 26 }} />
          </View>

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.label}>اسم القناة</Text>
              <TextInput
                testID="channel-name-input"
                style={styles.input}
                placeholder="مثال: beIN SPORTS 1"
                placeholderTextColor={colors.onSurfaceTertiary}
                value={name}
                onChangeText={setName}
              />
              <Text style={styles.label}>رابط الشعار (اختياري)</Text>
              <TextInput
                testID="channel-logo-input"
                style={styles.input}
                placeholder="https://..."
                placeholderTextColor={colors.onSurfaceTertiary}
                value={logo}
                onChangeText={setLogo}
                autoCapitalize="none"
              />

              <View style={styles.streamsHeader}>
                <Text style={styles.sectionTitle}>الروابط ({streams.length})</Text>
                <Pressable testID="add-stream-button" style={styles.addStreamBtn} onPress={addStream}>
                  <Ionicons name="add" size={18} color={colors.brand} />
                  <Text style={styles.addStreamText}>إضافة رابط</Text>
                </Pressable>
              </View>

              {streams.map((s, idx) => (
                <View key={s.id} testID={`stream-editor-${idx}`} style={styles.streamCard}>
                  <View style={styles.streamCardHeader}>
                    <Text style={styles.streamCardTitle}>رابط {idx + 1}</Text>
                    {streams.length > 1 && (
                      <Pressable testID={`remove-stream-${idx}`} hitSlop={8} onPress={() => removeStream(idx)}>
                        <Ionicons name="close-circle" size={22} color={colors.error} />
                      </Pressable>
                    )}
                  </View>
                  <TextInput
                    testID={`stream-label-${idx}`}
                    style={styles.input}
                    placeholder="اسم الرابط (مثال: HD)"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    value={s.label}
                    onChangeText={(t) => updateStream(idx, { label: t })}
                  />
                  <TextInput
                    testID={`stream-url-${idx}`}
                    style={styles.input}
                    placeholder="رابط البث (m3u8 / ts / mpd)"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    value={s.url}
                    onChangeText={(t) => updateStream(idx, { url: t })}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <View style={styles.typeRow}>
                    {STREAM_TYPES.map((t) => (
                      <Pressable
                        key={t}
                        testID={`stream-type-${idx}-${t}`}
                        style={[styles.typeChip, s.type === t && styles.typeChipActive]}
                        onPress={() => updateStream(idx, { type: t })}
                      >
                        <Text style={[styles.typeChipText, s.type === t && styles.typeChipTextActive]}>
                          {t.toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    testID={`stream-ua-${idx}`}
                    style={styles.input}
                    placeholder="User-Agent (اختياري)"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    value={s.user_agent}
                    onChangeText={(t) => updateStream(idx, { user_agent: t })}
                    autoCapitalize="none"
                  />
                  <TextInput
                    testID={`stream-referer-${idx}`}
                    style={styles.input}
                    placeholder="Referer (اختياري)"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    value={s.referer}
                    onChangeText={(t) => updateStream(idx, { referer: t })}
                    autoCapitalize="none"
                  />
                </View>
              ))}
            </ScrollView>
          </KeyboardAvoidingView>

          <View style={[styles.saveBar, { paddingBottom: insets.bottom + spacing.md }]}>
            <Pressable testID="save-channel-button" style={styles.saveBtn} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>حفظ القناة</Text>}
            </Pressable>
          </View>
        </View>
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
  editorContainer: { flex: 1, backgroundColor: colors.surface },
  label: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "700", marginBottom: spacing.xs, textAlign: "right" },
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
    marginBottom: spacing.md,
  },
  streamsHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  addStreamBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  addStreamText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  streamCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  streamCardHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  streamCardTitle: { color: colors.brand, fontSize: 14, fontWeight: "800" },
  typeRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  typeChipText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  typeChipTextActive: { color: "#fff" },
  saveBar: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
