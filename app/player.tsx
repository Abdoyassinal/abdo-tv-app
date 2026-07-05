import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Platform,
  Linking,
  AppState,
  BackHandler,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius } from "@/src/theme/colors";
import { api, Channel, Stream } from "@/src/api/client";

/* -------------------------------------------------------------------------- */
/*                         MIME + URL utilities                                */
/* -------------------------------------------------------------------------- */

function normalize(url: string): string {
  return (url || "").split("?")[0].toLowerCase();
}

function mimeOf(stream: Stream): string {
  const t = (stream.type || "").toLowerCase();
  if (t === "hls" || t === "m3u8" || t === "m3u") return "application/vnd.apple.mpegurl";
  if (t === "dash" || t === "mpd") return "application/dash+xml";
  if (t === "ts") return "video/mp2t";

  const p = normalize(stream.url);
  if (p.includes(".m3u8") || p.endsWith(".m3u")) return "application/vnd.apple.mpegurl";
  if (p.includes(".mpd")) return "application/dash+xml";
  if (p.endsWith(".ts")) return "video/mp2t";
  if (p.endsWith(".mp4") || p.endsWith(".m4v") || p.endsWith(".mov")) return "video/mp4";
  if (p.endsWith(".mkv")) return "video/x-matroska";
  if (p.endsWith(".webm")) return "video/webm";
  if (p.endsWith(".flv")) return "video/x-flv";
  if (p.endsWith(".mp3")) return "audio/mpeg";
  if (p.endsWith(".aac")) return "audio/aac";

  if (/\/live\//i.test(p) || /\/hls\//i.test(p) || /\/play\//i.test(p) || /\/stream\//i.test(p)) {
    return "application/vnd.apple.mpegurl";
  }
  return "video/*";
}

async function tryIosExternalPlayers(url: string): Promise<boolean> {
  const encoded = encodeURIComponent(url);
  const candidates = [
    `vlc-x-callback://x-callback-url/stream?url=${encoded}`,
    `vlc://${url}`,
    `infuse://x-callback-url/play?url=${encoded}`,
    `nplayer-${url}`,
  ];
  for (const link of candidates) {
    try {
      const ok = await Linking.canOpenURL(link);
      if (ok) {
        await Linking.openURL(link);
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}
async function launchExternal(
  stream: Stream,
  channelName: string,
): Promise<{ ok: boolean; message?: string }> {
  const url = stream.url;
  const mime = mimeOf(stream);

  if (Platform.OS === "android") {
    try {
      const intentUri = `intent:${url}#Intent;action=android.intent.action.VIEW;type=${mime};S.title=${encodeURIComponent(channelName)};end`;
      await Linking.openURL(intentUri);
      return { ok: true };
    } catch (e: any) {
      try {
        const fallbackUri = `intent:${url}#Intent;action=android.intent.action.VIEW;type=video/*;end`;
        await Linking.openURL(fallbackUri);
        return { ok: true };
      } catch {
        return {
          ok: false,
          message: "لا يوجد مشغّل مثبَّت على الهاتف يقبل هذا الرابط. ثبّت VLC أو MX Player من متجر Play.",
        };
      }
    }
  }

  const opened = await tryIosExternalPlayers(url);
  if (opened) return { ok: true };
  try {
    await Linking.openURL(url);
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "ثبّت VLC من App Store لتشغيل هذا النوع من الروابط.",
    };
  }
}

export default function PlayerScreen() {
  const router = useRouter();
  const { channelId, groupId } = useLocalSearchParams<{ channelId: string; groupId: string }>();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [current, setCurrent] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const autoLaunchedFor = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [chs, ch] = await Promise.all([
          groupId ? api.getChannels(groupId) : Promise.resolve([]),
          api.getChannel(channelId),
        ]);
        setChannels(chs);
        setCurrent(ch);
      } catch {
        setErrorMsg("تعذّر تحميل بيانات القناة");
      } finally {
        setLoading(false);
      }
    })();
  }, [channelId, groupId]);

  const onPickStream = useCallback(
    async (stream: Stream, opts?: { silent?: boolean }) => {
      if (!current) return;
      setLaunching(true);
      setErrorMsg(null);
      if (!opts?.silent) {
        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
      }
      const res = await launchExternal(stream, current.name);
      setLaunching(false);
      if (!res.ok && res.message) setErrorMsg(res.message);
    },
    [current],
  );

  useEffect(() => {
    if (!current || loading) return;
    if (autoLaunchedFor.current === current.id) return;
    if (current.streams.length !== 1) return;
    autoLaunchedFor.current = current.id;
    onPickStream(current.streams[0], { silent: true });
  }, [current, loading, onPickStream]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && current) autoLaunchedFor.current = current.id;
    });
    return () => sub.remove();
  }, [current]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      router.back();
      return true;
    });
    return () => sub.remove();
  }, [router]);

  const onSwitchChannel = (ch: Channel) => {
    if (ch.id === current?.id) return;
    setCurrent(ch);
    setErrorMsg(null);
    autoLaunchedFor.current = null;
  };

  const streams = useMemo(() => current?.streams ?? [], [current]);
  const singleAutoLaunch = current && streams.length === 1;
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable testID="player-back" style={styles.headerBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {current?.name || "القناة"}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            اختر الرابط المتاح لبدء التشغيل التلقائي
          </Text>
        </View>
      </View>

      {channels.length > 0 && (
        <View style={styles.pillWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {channels.map((ch) => {
              const active = ch.id === current?.id;
              return (
                <Pressable
                  key={ch.id}
                  testID={`channel-pill-${ch.id}`}
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => onSwitchChannel(ch)}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]} numberOfLines={1}>
                    {ch.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : !current ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={40} color={colors.error} />
          <Text style={styles.errorText}>القناة غير متوفرة</Text>
        </View>
      ) : streams.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="link-outline" size={40} color={colors.onSurfaceTertiary} />
          <Text style={styles.errorText}>لا توجد سيرفرات متاحة لهذه القناة</Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>
            {singleAutoLaunch ? "جارٍ فتح المشغّل الخاص بك..." : `السيرفرات المتاحة (${streams.length})`}
          </Text>

          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
            {streams.map((s, idx) => (
              <View key={s.id} style={styles.streamCard}>
                <Pressable
                  testID={`link-play-${idx}`}
                  style={styles.streamMain}
                  onPress={() => onPickStream(s)}
                  disabled={launching}
                >
                  <View style={styles.playIconWrap}>
                    <Ionicons name="play" size={22} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.streamLabel} numberOfLines={1}>
                      {s.label || `سيرفر البث البث ${idx + 1}`}
                    </Text>
                    <Text style={styles.streamMeta} numberOfLines={1}>
                      تشفير مستقر · تشغيل آمن بمشغّل خارجي
                    </Text>
                  </View>
                  <Ionicons name="open-outline" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
              </View>
            ))}
          </ScrollView>

          <Text style={styles.hint}>
            نصيحة: ثبّت <Text style={{ fontWeight: "800" }}>VLC</Text> أو <Text style={{ fontWeight: "800" }}>MX Player</Text> على هاتفك لتجربة مشاهدة مثالية.
          </Text>
        </>
      )}

      {errorMsg && (
        <View style={styles.errBanner}>
          <Ionicons name="alert-circle" size={18} color="#fff" />
          <Text style={styles.errBannerText}>{errorMsg}</Text>
          <Pressable onPress={() => setErrorMsg(null)}>
            <Ionicons name="close" size={18} color="#fff" />
          </Pressable>
        </View>
      )}

      {launching && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>يتم فتح المشغّل بشكل آمن...</Text>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row-reverse", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  headerTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800", textAlign: "right" },
  headerSub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2, textAlign: "right" },
  pillWrap: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pillRow: { alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  pill: { height: 36, justifyContent: "center", flexShrink: 0, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  pillActive: { backgroundColor: colors.brand },
  pillText: { color: colors.onSurface, fontWeight: "700", fontSize: 13, maxWidth: 140 },
  pillTextActive: { color: "#fff" },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, textAlign: "right" },
  streamCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  streamMain: { flexDirection: "row-reverse", alignItems: "center", gap: spacing.md, padding: spacing.md },
  playIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  streamLabel: { color: colors.onSurface, fontSize: 15, fontWeight: "700", textAlign: "right" },
  streamMeta: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2, textAlign: "right" },
  hint: { color: colors.onSurfaceTertiary, fontSize: 12, textAlign: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  errorText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  errBanner: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.lg, flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.error },
  errBannerText: { color: "#fff", fontSize: 13, fontWeight: "700", flex: 1, textAlign: "right" },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", gap: spacing.md },
  overlayText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
