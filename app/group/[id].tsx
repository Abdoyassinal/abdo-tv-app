import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius } from "@/src/theme/colors";
import { api, Channel } from "@/src/api/client";

export default function GroupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.getChannels(id);
      setChannels(data);
    } catch (e) {
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openChannel = (channel: Channel) => {
    if (!channel.streams || channel.streams.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/player",
      params: { channelId: channel.id, groupId: id },
    });
  };

  const renderChannel = ({ item }: { item: Channel }) => {
    const hasStream = item.streams && item.streams.length > 0;
    return (
      <Pressable
        testID={`channel-item-${item.id}`}
        style={({ pressed }) => [styles.channel, pressed && styles.channelPressed]}
        onPress={() => openChannel(item)}
      >
        <View style={styles.logoWrap}>
          {item.logo ? (
            <Image source={{ uri: item.logo }} style={styles.logo} contentFit="contain" />
          ) : (
            <Ionicons name="tv" size={26} color={colors.brand} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.channelName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.channelMeta}>
            {hasStream ? `${item.streams.length} رابط` : "لا يوجد رابط"}
          </Text>
        </View>
        <Ionicons
          name="play-circle"
          size={30}
          color={hasStream ? colors.brand : colors.onSurfaceTertiary}
        />
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-forward" size={26} color={colors.onBrandPrimary} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {name || "القنوات"}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : channels.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="tv-outline" size={48} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyText}>لا توجد قنوات في هذه المجموعة</Text>
        </View>
      ) : (
        <FlatList
          testID="channels-list"
          data={channels}
          keyExtractor={(c) => c.id}
          renderItem={renderChannel}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
        />
      )}
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
  title: { color: colors.onBrandPrimary, fontSize: 19, fontWeight: "800", flex: 1, textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 16 },
  channel: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  channelPressed: { opacity: 0.7, borderColor: colors.brand },
  logoWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: "100%", height: "100%" },
  channelName: { color: colors.onSurface, fontSize: 16, fontWeight: "700", textAlign: "right" },
  channelMeta: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: "right", marginTop: 2 },
});
