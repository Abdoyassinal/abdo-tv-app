import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Platform,
  BackHandler,
  StatusBar,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import Video, {
  VideoRef,
  ResizeMode,
  OnLoadData,
  OnProgressData,
  OnVideoErrorData,
} from "react-native-video";
import * as ScreenOrientation from "expo-screen-orientation";
import { SystemBars } from "react-native-edge-to-edge";
import * as Haptics from "expo-haptics";
import * as NavigationBar from "expo-navigation-bar";

import { colors, spacing, radius } from "@/src/theme/colors";
import { api, Channel, Stream } from "@/src/api/client";

/* -------------------------------------------------------------------------- */
/*                    Content-type / source-type detection                    */
/* -------------------------------------------------------------------------- */

// react-native-video accepts the following override types for Media3 / ExoPlayer.
// Setting the right value forces the correct extractor and avoids the
// "SOURCE_ERROR" that ExoPlayer throws on ambiguous IPTV URLs.
type RNVType = "m3u8" | "mpd" | "ts" | undefined;

function normalize(url: string): string {
  return (url || "").split("?")[0].toLowerCase();
}

// Force a specific extractor when the URL clearly points to that container.
// For live IPTV endpoints that have no extension (Xtream / stalker / custom
// panels), we assume HLS because that is by far the most common wire format.
function detectRnvType(url: string, adminType?: string): RNVType {
  const t = (adminType || "").toLowerCase();
  if (t === "hls" || t === "m3u8" || t === "m3u") return "m3u8";
  if (t === "dash" || t === "mpd") return "mpd";
  if (t === "ts") return "ts";

  const path = normalize(url);
  if (path.includes(".m3u8") || path.endsWith(".m3u")) return "m3u8";
  if (path.includes(".mpd")) return "mpd";
  if (path.endsWith(".ts") || path.includes(".ts?") || /\.ts$/.test(path)) return "ts";

  // Extensionless live-stream heuristics (Xtream, stalker, custom panels).
  if (
    /\/live\//i.test(path) ||
    /\/hls\//i.test(path) ||
    /\/play\//i.test(path) ||
    /\/stream\//i.test(path)
  ) {
    return "m3u8";
  }

  return undefined; // let Media3 auto-detect (mp4/mkv/webm/mp3/aac progressive)
}

// Many IPTV servers reject requests with the default player UA or with no
// Referer/Origin at all. We send a widely-accepted browser UA by default and
// derive Referer/Origin from the stream URL when the admin has not configured
// them from the control panel.
const DEFAULT_UA =
  "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function originOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

type BuiltSource = {
  uri: string;
  type?: RNVType;
  headers: Record<string, string>;
};

function buildSource(stream: Stream): BuiltSource {
  const headers: Record<string, string> = {};
  if (stream.user_agent) headers["User-Agent"] = stream.user_agent;
  if (stream.referer) headers["Referer"] = stream.referer;

  if (!headers["User-Agent"]) headers["User-Agent"] = DEFAULT_UA;

  const origin = originOf(stream.url);
  if (!headers["Referer"] && origin) headers["Referer"] = origin + "/";
  if (!headers["Origin"] && origin) headers["Origin"] = origin;
  if (!headers["Icy-MetaData"]) headers["Icy-MetaData"] = "1";
  // Extra headers some CDNs require:
  if (!headers["Accept"]) headers["Accept"] = "*/*";
  if (!headers["Connection"]) headers["Connection"] = "keep-alive";

  const type = detectRnvType(stream.url, stream.type);

  return {
    uri: stream.url,
    type,
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

const RESIZE_MODES: ResizeMode[] = [
  ResizeMode.CONTAIN,
  ResizeMode.COVER,
  ResizeMode.STRETCH,
];

/* -------------------------------------------------------------------------- */
/*                              Immersive helpers                             */
/* -------------------------------------------------------------------------- */

async function enterImmersive() {
  try {
    StatusBar.setHidden(true, "fade");
  } catch {}
  if (Platform.OS === "android") {
    try {
      await NavigationBar.setVisibilityAsync("hidden");
      await NavigationBar.setBehaviorAsync("overlay-swipe");
      await NavigationBar.setBackgroundColorAsync("#00000000");
      await NavigationBar.setButtonStyleAsync("light");
    } catch {}
  }
}

async function exitImmersive() {
  try {
    StatusBar.setHidden(false, "fade");
  } catch {}
  if (Platform.OS === "android") {
    try {
      await NavigationBar.setVisibilityAsync("visible");
      await NavigationBar.setBehaviorAsync("inset-touch");
    } catch {}
  }
}

// Tuned for live IPTV: small min buffer so the stream starts fast, larger max
// buffer so playback survives brief network stalls without stopping.
const LIVE_BUFFER = {
  minBufferMs: 2500,
  maxBufferMs: 50000,
  bufferForPlaybackMs: 1500,
  bufferForPlaybackAfterRebufferMs: 3000,
};

/* -------------------------------------------------------------------------- */
/*                                 Screen                                     */
/* -------------------------------------------------------------------------- */

export default function PlayerScreen() {
  const router = useRouter();
  const { channelId, groupId } = useLocalSearchParams<{ channelId: string; groupId: string }>();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [current, setCurrent] = useState<Channel | null>(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [showLinks, setShowLinks] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [resizeIdx, setResizeIdx] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [progress, setProgress] = useState({ current: 0, duration: 0 });
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "error">("loading");
  const [retryTick, setRetryTick] = useState(0);

  const videoRef = useRef<VideoRef>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryCount = useRef(0);

  const stream: Stream | null = current?.streams?.[streamIndex] || null;

  // Re-build the source whenever the stream/retry changes. `key` uses the same
  // signals so <Video> is fully re-mounted on retry (avoids stuck buffers).
  const source = useMemo<BuiltSource | null>(
    () => (stream ? buildSource(stream) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream, retryTick]
  );
  const sourceKey = useMemo(
    () => `${stream?.id || "none"}-${retryTick}`,
    [stream, retryTick]
  );

  /* ---------------------- Lifecycle: orientation + immersive ---------------------- */
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    enterImmersive();
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      exitImmersive();
    };
  }, []);

  useEffect(() => {
    if (!controlsVisible) enterImmersive();
  }, [controlsVisible]);
  useEffect(() => {
    if (status === "playing") enterImmersive();
  }, [status]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      exitImmersive();
      router.back();
      return true;
    });
    return () => sub.remove();
  }, [router]);

  /* ---------------------- Load channels + current channel ---------------------- */
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
        autoRetryCount.current = 0;
      } catch {
        // ignore
      }
    })();
  }, [channelId, groupId]);

  /* ---------------------- Controls auto-hide ---------------------- */
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

  /* ---------------------- Automatic error recovery ---------------------- */
  useEffect(() => {
    if (errorTimer.current) {
      clearTimeout(errorTimer.current);
      errorTimer.current = null;
    }
    if (status !== "error") {
      autoRetryCount.current = 0;
      return;
    }
    if (!current || !current.streams?.length) return;

    const total = current.streams.length;
    if (autoRetryCount.current >= total) return;

    errorTimer.current = setTimeout(() => {
      autoRetryCount.current += 1;
      if (total > 1) setStreamIndex((i) => (i + 1) % total);
      else setRetryTick((t) => t + 1);
    }, 1500);
  }, [status, current]);

  /* ---------------------- Video event handlers ---------------------- */
  const onLoadStart = () => setStatus("loading");

  const onLoad = (data: OnLoadData) => {
    setStatus("playing");
    setProgress((p) => ({ ...p, duration: isFinite(data.duration) ? data.duration : 0 }));
  };

  const onProgress = (p: OnProgressData) => {
    setProgress({
      current: p.currentTime || 0,
      duration: isFinite(p.seekableDuration) ? p.seekableDuration : 0,
    });
  };

  const onBuffer = ({ isBuffering }: { isBuffering: boolean }) => {
    if (isBuffering) setStatus("loading");
    else if (!paused) setStatus("playing");
  };

  const onError = (_e: OnVideoErrorData) => {
    setStatus("error");
  };

  const onEnd = () => {
    setPaused(true);
    setStatus("idle");
  };

  /* ---------------------- User actions ---------------------- */
  const toggleControls = () => setControlsVisible((v) => !v);

  const togglePlay = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPaused((p) => !p);
    scheduleHide();
  };

  const seekBy = (delta: number) => {
    const t = Math.max(0, progress.current + delta);
    videoRef.current?.seek(t);
    scheduleHide();
  };

  const switchChannel = (ch: Channel) => {
    if (ch.id === current?.id) return;
    if (!ch.streams || ch.streams.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCurrent(ch);
    setStreamIndex(0);
    autoRetryCount.current = 0;
    setPaused(false);
    setControlsVisible(true);
  };

  const selectStream = (idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    autoRetryCount.current = 0;
    setStreamIndex(idx);
    setPaused(false);
    setShowLinks(false);
    setControlsVisible(true);
  };

  const cycleFit = () => {
    setResizeIdx((i) => (i + 1) % RESIZE_MODES.length);
    scheduleHide();
  };

  const manualRetry = () => {
    autoRetryCount.current = 0;
    setPaused(false);
    setRetryTick((t) => t + 1);
  };

  const onSeekBarPress = (e: any) => {
    if (!progress.duration || barWidth === 0) return;
    const x = e.nativeEvent.locationX;
    const frac = Math.max(0, Math.min(1, x / barWidth));
    videoRef.current?.seek(frac * progress.duration);
    scheduleHide();
  };

  const isLive = !progress.duration || progress.duration === 0;
  const fillPct = isLive ? 0 : (progress.current / progress.duration) * 100;
  const buffering = status === "loading";
  const isPlaying = status === "playing" && !paused;

  return (
    <View style={styles.container}>
      <SystemBars hidden />

      <Pressable style={styles.videoTouch} onPress={toggleControls}>
        {source ? (
          <Video
            key={sourceKey}
            ref={videoRef}
            source={source}
            style={styles.video}
            resizeMode={RESIZE_MODES[resizeIdx]}
            paused={paused}
            controls={false}
            playInBackground={false}
            playWhenInactive={false}
            ignoreSilentSwitch="ignore"
            progressUpdateInterval={1000}
            onLoadStart={onLoadStart}
            onLoad={onLoad}
            onProgress={onProgress}
            onBuffer={onBuffer}
            onError={onError}
            onEnd={onEnd}
            bufferConfig={LIVE_BUFFER}
            // Media3 tunings — keep the display awake and avoid stalling on live TS
            disableFocus={false}
            hideShutterView
            reportBandwidth
          />
        ) : null}
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
          <View style={styles.errorRow}>
            <Pressable testID="retry-stream" style={styles.errorBtn} onPress={manualRetry}>
              <Text style={styles.errorBtnText}>إعادة المحاولة</Text>
            </Pressable>
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
        </View>
      )}

      {controlsVisible && (
        <>
          {/* Top bar: back + channel pills */}
          <View style={styles.topBar}>
            <Pressable
              testID="player-back"
              style={styles.backBtn}
              onPress={() => {
                exitImmersive();
                router.back();
              }}
            >
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
  errorRow: { flexDirection: "row", gap: spacing.md },
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
