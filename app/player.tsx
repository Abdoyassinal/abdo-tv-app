import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import * as ScreenOrientation from "expo-screen-orientation";
import { SystemBars } from "react-native-edge-to-edge";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius } from "@/src/theme/colors";
import { api, Channel, Stream } from "@/src/api/client";

function mapContentType(type: string): "hls" | "dash" | "progressive" | undefined {
  switch ((type || "").toLowerCase()) {
    case "hls":
    case "m3u8":
      return "hls";
    case "dash":
    case "mpd":
      return "dash";
    case "ts":
    case "progressive":
      return "progressive";
    default:
      return undefined; // auto
  }
}

// When type is "auto", detect from the URL path (ignoring query string).
function detectFromUrl(url: string): "hls" | "dash" | "progressive" | undefined {
  const path = (url || "").split("?")[0].toLowerCase();
  if (path.endsWith(".m3u8") || path.includes(".m3u8")) return "hls";
  if (path.endsWith(".mpd") || path.includes(".mpd")) return "dash";
  if (path.endsWith(".ts") || path.includes(".ts")) return "progressive";
  return undefined;
}

// Some IPTV servers reject requests that have no User-Agent (or the default
// player UA). Provide a widely-accepted fallback for raw/progressive streams.
const DEFAULT_UA =
  "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function buildSource(stream: Stream) {
  const headers: Record<string, string> = {};
  if (stream.user_agent) headers["User-Agent"] = stream.user_agent;
  if (stream.referer) headers["Referer"] = stream.referer;

  let contentType = mapContentType(stream.type);
  if (!contentType) contentType = detectFromUrl(stream.url);

  // Many IPTV servers reject requests that have no User-Agent. Always send one
  // (for HLS/DASH/progressive) unless the admin provided a custom value.
  if (!headers["User-Agent"]) {
    headers["User-Agent"] = DEFAULT_UA;
  }

  return {
    uri: stream.url,
    contentType,
    headers,
  };
}

function fmt(sec: number) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const CONTAIN_MODES: ("contain" | "cover" | "fill")[] = ["contain", "cover", "fill"];

export default function PlayerScreen() {
  const router = useRouter();
  const { channelId, groupId } = useLocalSearchParams<{ channelId: string; groupId: string }>();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [current, setCurrent] = useState<Channel | null>(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [showLinks, setShowLinks] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [contentFitIdx, setContentFitIdx] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [progress, setProgress] = useState({ current: 0, duration: 0 });

  const videoRef = useRef<VideoView>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialStream: Stream | null = current?.streams?.[streamIndex] || null;

  const player = useVideoPlayer(
    initialStream ? buildSource(initialStream) : null,
    (p) => {
      p.timeUpdateEventInterval = 1;
      p.play();
    }
  );

  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  useEvent(player, "timeUpdate", {
    currentTime: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });

  // Poll progress off the player each second via timeUpdate side-effect
  useEffect(() => {
    const sub = player.addListener("timeUpdate", (payload) => {
      setProgress({
        current: payload.currentTime || 0,
        duration: isFinite(player.duration) ? player.duration : 0,
      });
    });
    return () => sub.remove();
  }, [player]);

  // Lock landscape while the player is mounted. System bars are hidden
  // declaratively via <SystemBars hidden /> (edge-to-edge compatible).
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  // Load channels of group + current channel
  useEffect(() => {
    (async () => {
      try {
        const [chs, ch] = await Promise.all([
          groupId ? api.getChannels(groupId) : Promise.resolve([]),
          api.getChannel(channelId),
        ]);
        setChannels(chs);
        setCurrent(ch);
        setStreamIndex(0);
      } catch (e) {
        // ignore
      }
    })();
  }, [channelId, groupId]);

  // Replace source when channel/stream changes
  useEffect(() => {
    const s = current?.streams?.[streamIndex];
    if (s && player) {
      player.replace(buildSource(s));
      player.play();
    }
  }, [current, streamIndex]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 4000);
  }, []);

  useEffect(() => {
    if (controlsVisible) scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [controlsVisible, scheduleHide]);

  const toggleControls = () => setControlsVisible((v) => !v);

  const togglePlay = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isPlaying) player.pause();
    else player.play();
    scheduleHide();
  };

  const seekBy = (delta: number) => {
    player.seekBy(delta);
    scheduleHide();
  };

  const switchChannel = (ch: Channel) => {
    if (ch.id === current?.id) return;
    if (!ch.streams || ch.streams.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCurrent(ch);
    setStreamIndex(0);
    setControlsVisible(true);
  };

  const selectStream = (idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStreamIndex(idx);
    setShowLinks(false);
    setControlsVisible(true);
  };

  const cycleFit = () => {
    setContentFitIdx((i) => (i + 1) % CONTAIN_MODES.length);
    scheduleHide();
  };

  const onSeekBarPress = (e: any) => {
    if (!progress.duration || barWidth === 0) return;
    const x = e.nativeEvent.locationX;
    const frac = Math.max(0, Math.min(1, x / barWidth));
    player.currentTime = frac * progress.duration;
    scheduleHide();
  };

  const isLive = !progress.duration || progress.duration === 0;
  const fillPct = isLive ? 0 : (progress.current / progress.duration) * 100;
  const buffering = status === "loading";

  return (
    <View style={styles.container}>
      <SystemBars hidden />
      <Pressable style={styles.videoTouch} onPress={toggleControls}>
        <VideoView
          ref={videoRef}
          player={player}
          style={styles.video}
          contentFit={CONTAIN_MODES[contentFitIdx]}
          nativeControls={false}
          allowsPictureInPicture
        />
      </Pressable>

      {/* Buffering */}
      {buffering && (
        <View style={[styles.centerOverlay, { pointerEvents: "none" }]}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      )}

      {/* Error */}
      {status === "error" && (
        <View style={styles.centerOverlay}>
          <Ionicons name="warning-outline" size={40} color={colors.error} />
          <Text style={styles.errorText}>تعذّر تشغيل البث</Text>
          {current && current.streams.length > 1 && (
            <Pressable
              testID="switch-stream-error"
              style={styles.errorBtn}
              onPress={() => selectStream((streamIndex + 1) % current.streams.length)}
            >
              <Text style={styles.errorBtnText}>تجربة رابط آخر</Text>
            </Pressable>
          )}
        </View>
      )}

      {controlsVisible && (
        <>
          {/* Top bar: back + channel pills */}
          <View style={styles.topBar}>
            <Pressable testID="player-back" style={styles.backBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color={colors.onBrandPrimary} />
            </Pressable>
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
                    onPress={() => switchChannel(ch)}
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

          {/* Center controls */}
          <View style={[styles.centerControls, { pointerEvents: "box-none" }]}>
            <Pressable testID="rewind-button" style={styles.ctrlBtn} onPress={() => seekBy(-10)}>
              <MaterialIcons name="replay-10" size={34} color="#fff" />
            </Pressable>
            <Pressable
              testID="stream-settings-button"
              style={styles.ctrlBtn}
              onPress={() => {
                setShowLinks(true);
                setControlsVisible(true);
              }}
            >
              <Ionicons name="settings-sharp" size={28} color="#fff" />
            </Pressable>
            <Pressable testID="play-pause-button" style={styles.playBtn} onPress={togglePlay}>
              <Ionicons name={isPlaying ? "pause" : "play"} size={40} color="#fff" />
            </Pressable>
            <Pressable testID="aspect-button" style={styles.ctrlBtn} onPress={cycleFit}>
              <MaterialIcons name="aspect-ratio" size={30} color="#fff" />
            </Pressable>
            <Pressable testID="forward-button" style={styles.ctrlBtn} onPress={() => seekBy(10)}>
              <MaterialIcons name="forward-10" size={34} color="#fff" />
            </Pressable>
          </View>

          {/* Bottom seek bar */}
          <View style={styles.bottomBar}>
            {isLive ? (
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>مباشر LIVE</Text>
              </View>
            ) : (
              <>
                <Text style={styles.timeText}>{fmt(progress.current)}</Text>
                <Pressable
                  style={styles.seekTrack}
                  onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
                  onPress={onSeekBarPress}
                >
                  <View style={styles.seekBg} />
                  <View style={[styles.seekFill, { width: `${fillPct}%` }]} />
                  <View style={[styles.seekThumb, { left: `${fillPct}%` }]} />
                </Pressable>
                <Text style={styles.timeText}>{fmt(progress.duration)}</Text>
              </>
            )}
          </View>
        </>
      )}

      {/* Stream/link switcher */}
      {showLinks && current && (
        <Pressable style={styles.linksOverlay} onPress={() => setShowLinks(false)}>
          <Pressable style={styles.linksSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.linksTitle}>{current.name} — اختر الرابط</Text>
            <ScrollView style={{ maxHeight: 220 }}>
              {current.streams.map((s, idx) => (
                <Pressable
                  key={s.id}
                  testID={`link-option-${idx}`}
                  style={[styles.linkRow, idx === streamIndex && styles.linkRowActive]}
                  onPress={() => selectStream(idx)}
                >
                  <Ionicons
                    name={idx === streamIndex ? "radio-button-on" : "radio-button-off"}
                    size={20}
                    color={idx === streamIndex ? colors.brand : colors.onSurfaceTertiary}
                  />
                  <Text style={styles.linkLabel}>
                    {s.label || `رابط ${idx + 1}`} · {(s.type || "auto").toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  videoTouch: { ...StyleSheet.absoluteFillObject },
  video: { flex: 1, backgroundColor: "#000" },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  errorText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  errorBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  errorBtnText: { color: "#fff", fontWeight: "700" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.55)",
    gap: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pillRow: { alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs },
  pill: {
    height: 40,
    justifyContent: "center",
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  pillActive: { backgroundColor: colors.warning },
  pillText: { color: "#111", fontWeight: "700", fontSize: 13, maxWidth: 140 },
  pillTextActive: { color: "#000" },
  centerControls: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
  },
  ctrlBtn: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(229,9,20,0.85)",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: "rgba(0,0,0,0.55)",
    gap: spacing.md,
  },
  timeText: { color: "#fff", fontSize: 12, fontWeight: "600", minWidth: 48, textAlign: "center" },
  seekTrack: { flex: 1, height: 24, justifyContent: "center" },
  seekBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  seekFill: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.brand,
  },
  seekThumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
    marginLeft: -7,
  },
  liveRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  liveText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  linksOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  linksSheet: {
    width: "70%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linksTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: spacing.md,
    textAlign: "right",
  },
  linkRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  linkRowActive: { backgroundColor: colors.surfaceTertiary },
  linkLabel: { color: colors.onSurface, fontSize: 14, fontWeight: "600", flex: 1, textAlign: "right" },
});
