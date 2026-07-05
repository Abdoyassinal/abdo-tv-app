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
  ToastAndroid,
  AppState,
  BackHandler,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as IntentLauncher from "expo-intent-launcher";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius } from "@/src/theme/colors";
import { api, Channel, Stream } from "@/src/api/client";

/* -------------------------------------------------------------------------- */
/*                         MIME + URL utilities                                */
/* -------------------------------------------------------------------------- */

function normalize(url: string): string {
  return (url || "").split("?")[0].toLowerCase();
}

// Map the stream to a MIME type. Android uses this to decide which apps to
// offer in the "Open with..." chooser. `video/*` is the widest — every video
// player on the phone (VLC, MX Player, Kodi, nPlayer, Just Player, ...) will
// appear. Specific MIME types help players jump straight into IPTV mode.
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

  // Extensionless IPTV endpoints -> assume HLS (most common wire format).
  if (/\/live\//i.test(p) || /\/hls\//i.test(p) || /\/play\//i.test(p) || /\/stream\//i.test(p)) {
    return "application/vnd.apple.mpegurl";
  }
  return "video/*";
}

// Try known deep-link schemes on iOS (VLC / Infuse / nPlayer).
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
      // ignore and try next
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*                            External launcher                                */
/* -------------------------------------------------------------------------- */

const ANDROID_FLAG_NEW_TASK = 0x10000000; // FLAG_ACTIVITY_NEW_TASK
const ANDROID_FLAG_GRANT_READ = 0x00000001; // FLAG_GRANT_READ_URI_PERMISSION

async function launchExternal(
  stream: Stream,
  channelName: string,
): Promise<{ ok: boolean; message?: string }> {
  const url = stream.url;
  const mime = mimeOf(stream);

  if (Platform.OS === "android") {
    // Pass User-Agent / Referer as intent extras — VLC, MX Player, Just Player,
    // nPlayer and Kodi all read these standard keys.
    const extra: Record<string, string> = {
      title: channelName,
      "android.intent.extra.TITLE": channelName,
    };
    if (stream.user_agent) {
      extra["User-Agent"] = stream.user_agent;
      extra["http-user-agent"] = stream.user_agent;
    }
    if (stream.referer) {
      extra["Referer"] = stream.referer;
      extra["http-referrer"] = stream.referer;
    }

    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: url,
        type: mime,
        flags: ANDROID_FLAG_NEW_TASK | ANDROID_FLAG_GRANT_READ,
        extra,
      });
      return { ok: true };
    } catch (e: any) {
      // Retry with a wider video/* MIME so the OS shows every video app.
      if (mime !== "video/*") {
        try {
          await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
            data: url,
            type: "video/*",
            flags: ANDROID_FLAG_NEW_TASK,
            extra,
          });
          return { ok: true };
        } catch {}
      }
      return {
        ok: false,
        message:
          "لا يوجد مشغّل مثبَّت على الهاتف يقبل هذا الرابط. ثبّت VLC أو MX Player من متجر Play.",
      };
    }
  }

  // iOS: no intent chooser — try VLC/Infuse/nPlayer schemes, fall back to Safari.
  const opened = await tryIosExternalPlayers(url);
  if (opened) return { ok: true };
  try {
    await Linking.openURL(url);
    return { ok: true };
  } catch {
    return {
      ok: false,
      message:
        "ثبّت VLC من App Store لتشغيل هذا النوع من الروابط، أو انسخ الرابط والصقه في تطبيق المشغّل.",
    };
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Screen                                     */
/* -------------------------------------------------------------------------- */

export default function PlayerScreen() {
  const router = useRouter();
  const { channelId, groupId } = useLocalSearchParams<{ channelId: string; groupId: string }>();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [current, setCurrent] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Remember whether we already auto-launched for the current channel so we
  // don't re-open the external chooser every time the user returns to the app.
  const autoLaunchedFor = useRef<string | null>(null);

  /* ---------------------- Load data ---------------------- */
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

  /* ---------------------- Actions ---------------------- */
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

  // Auto-launch if the channel has exactly one link — best UX for the common case.
  useEffect(() => {
    if (!current || loading) return;
    if (autoLaunchedFor.current === current.id) return;
    if (current.streams.length !== 1) return;
    autoLaunchedFor.current = current.id;
    onPickStream(current.streams[0], { silent: true });
  }, [current, loading, onPickStream]);

  // When the user returns to our app, don't auto-launch again for the same channel.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && current) autoLaunchedFor.current = current.id;
    });
    return () => sub.remove();
  }, [current]);

  // Hardware back → return to previous screen (channel list).
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
    // Allow auto-launch again for the new channel if it has one link.
    autoLaunchedFor.current = null;
  };

  const copyUrl = async (url: string) => {
    await Clipboard.setStringAsync(url);
    if (Platform.OS === "android") {
      ToastAndroid.show("تم نسخ الرابط", ToastAndroid.SHORT);
    }
  };

  const streams = useMemo(() => current?.streams ?? [], [current]);
  const singleAutoLaunch = current && streams.length === 1;

  /* ---------------------- Render ---------------------- */
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable testID="player-back" style={styles.headerBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {current?.name || "القناة"}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            اختر رابط ثم اختر المشغّل من الهاتف
          </Text>
        </View>
      </View>

      {/* Channel switcher pills */}
      {channels.length > 0 && (
        <View style={styles.pillWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillRow}
          >
            {channels.map((ch) => {
              const active = ch.id === current?.id;
              return (
                <Pressable
                  key={ch.id}
                  testID={`channel-pill-${ch.id}`}
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => onSwitchChannel(ch)}
                >
                  <Text
                    style={[styles.pillText, active && styles.pillTextActive]}
                    numberOfLines={1}
                  >
                    {ch.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Content */}
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
          <Text style={styles.errorText}>لا توجد روابط لهذه القناة</Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>
            {singleAutoLaunch ? "جارٍ فتح المشغّل..." : `الروابط المتاحة (${streams.length})`}
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
                      {s.label || `رابط ${idx + 1}`}
                    </Text>
                    <Text style={styles.streamMeta} numberOfLines={1}>
                      {(s.type || "auto").toUpperCase()} · تشغيل بمشغّل خارجي
                    </Text>
                  </View>
                  <Ionicons name="open-outline" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
                <Pressable
                  testID={`link-copy-${idx}`}
                  style={styles.copyBtn}
                  onPress={() => copyUrl(s.url)}
                >
                  <Ionicons name="copy-outline" size={16} color={colors.onSurfaceSecondary} />
                  <Text style={styles.copyText}>نسخ</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>

          <Text style={styles.hint}>
            نصيحة: ثبّت <Text style={{ fontWeight: "800" }}>VLC</Text> أو{" "}
            <Text style={{ fontWeight: "800" }}>MX Player</Text> لتشغيل أفضل لقنوات IPTV.
          </Text>
        </>
      )}

      {/* Error toast */}
      {errorMsg && (
        <View style={styles.errBanner}>
          <Ionicons name="alert-circle" size={18} color="#fff" />
          <Text style={styles.errBannerText}>{errorMsg}</Text>
          <Pressable onPress={() => setErrorMsg(null)}>
            <Ionicons name="close" size={18} color="#fff" />
          </Pressable>
        </View>
      )}

      {/* Launching overlay */}
      {launching && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>يتم فتح المشغّل...</Text>
        </View>
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Styles                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  headerTitle: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "right",
  },
  headerSub: {
    color: colors.onSurfaceSecondary,
    fontSize: 12,
    marginTop: 2,
    textAlign: "right",
  },
  pillWrap: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pillRow: { alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  pill: {
    height: 36,
    justifyContent: "center",
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
  },
  pillActive: { backgroundColor: colors.brand },
  pillText: {
    color: colors.onSurface,
    fontWeight: "700",
    fontSize: 13,
    maxWidth: 140,
  },
  pillTextActive: { color: "#fff" },
  sectionTitle: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    textAlign: "right",
  },
  streamCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  streamMain: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  playIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  streamLabel: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
  },
  streamMeta: {
    color: colors.onSurfaceSecondary,
    fontSize: 12,
    marginTop: 2,
    textAlign: "right",
  },
  copyBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
  },
  copyText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  hint: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  errorText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  errBanner: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.error,
  },
  errBannerText: { color: "#fff", fontSize: 13, fontWeight: "700", flex: 1, textAlign: "right" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  overlayText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
