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
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import * as ScreenOrientation from "expo-screen-orientation";
import { SystemBars } from "react-native-edge-to-edge";
import * as Haptics from "expo-haptics";
import * as NavigationBar from "expo-navigation-bar";
import { useKeepAwake } from "expo-keep-awake";

import { colors, spacing, radius } from "@/src/theme/colors";
import { api, Channel, Stream } from "@/src/api/client";

/* -------------------------------------------------------------------------- */
/*                            Format detection                                */
/* -------------------------------------------------------------------------- */

type ContentType = "hls" | "dash" | "progressive" | undefined;

function mapContentType(type: string): ContentType {
  switch ((type || "").toLowerCase()) {
    case "hls":
    case "m3u8":
    case "m3u":
      return "hls";
    case "dash":
    case "mpd":
      return "dash";
    // Progressive HTTP/HTTPS containers (ExoPlayer/AVPlayer supported)
    case "ts":
    case "mp4":
    case "m4v":
    case "mkv":
    case "webm":
    case "mov":
    case "flv":
    case "aac":
    case "mp3":
    case "progressive":
    case "http":
    case "https":
      return "progressive";
    default:
      return undefined;
  }
}

// When type is "auto" or unknown, detect from the URL path (ignoring query string).
// If nothing matches but URL looks like an IPTV endpoint (no extension, has /live/
// or ends in a numeric id), default to HLS which is the most common IPTV format.
function detectFromUrl(url: string): ContentType {
  const clean = (url || "").split("?")[0].toLowerCase();

  if (clean.includes(".m3u8") || clean.endsWith(".m3u")) return "hls";
  if (clean.includes(".mpd")) return "dash";

  if (
    clean.endsWith(".ts") ||
    clean.endsWith(".mp4") ||
    clean.endsWith(".m4v") ||
    clean.endsWith(".mkv") ||
    clean.endsWith(".webm") ||
    clean.endsWith(".mov") ||
    clean.endsWith(".flv") ||
    clean.endsWith(".aac") ||
    clean.endsWith(".mp3")
  ) {
    return "progressive";
  }

  // Common IPTV url shapes with no extension (Xtream, stalker, custom):
  //   http://host:port/live/user/pass/123
  //   http://host/play/xxxx
  // ExoPlayer detects HLS reliably when we hint it.
  if (
    /\/live\//i.test(clean) ||
    /\/hls\//i.test(clean) ||
    /\/play\//i.test(clean) ||
    /\/stream\//i.test(clean)
  ) {
    return "hls";
  }

  return undefined;
}

// Many IPTV servers reject requests with no User-Agent, wrong Referer, or
// missing Origin. We send a widely-accepted browser UA by default, and copy
// the stream URL's origin as Referer/Origin when the admin didn't set one.
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

function buildSource(stream: Stream) {
  const headers: Record<string, string> = {};
  if (stream.user_agent) headers["User-Agent"] = stream.user_agent;
  if (stream.referer) headers["Referer"] = stream.referer;

  let contentType = mapContentType(stream.type);
  if (!contentType) contentType = detectFromUrl(stream.url);

  if (!headers["User-Agent"]) headers["User-Agent"] = DEFAULT_UA;

  // Some servers require a Referer/Origin that matches the URL host.
  const origin = originOf(stream.url);
  if (!headers["Referer"] && origin) headers["Referer"] = origin + "/";
  if (!headers["Origin"] && origin) headers["Origin"] = origin;

  // Icy metadata is harmless for video servers, but some HTTP audio streams
  // require it. Including it does not break other players.
  if (!headers["Icy-MetaData"]) headers["Icy-MetaData"] = "1";

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

/* -------------------------------------------------------------------------- */
/*                              Immersive helpers                             */
/* -------------------------------------------------------------------------- */

async function enterImmersive() {
  // Hide the OS status bar imperatively as a safety net (SystemBars declaratively
  // does this too, but StatusBar.setHidden helps on some Samsung/One UI builds).
  try {
    StatusBar.setHidden(true, "fade");
  } catch {}

  if (Platform.OS === "android") {
    try {
      // Hide the Android navigation bar and let it re-appear only on a swipe.
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

/* -------------------------------------------------------------------------- */
/*                                 Screen                                     */
/* -------------------------------------------------------------------------- */

export default function PlayerScreen() {
  const router = useRouter();
  const { channelId, groupId } = useLocalSearchParams<{ channelId: string; groupId: string }>();

  // Prevent the device from sleeping while the player screen is mounted.
  useKeepAwake();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [current, setCurrent] = useState<Channel | null>(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [showLinks, setShowLinks] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [contentFitIdx, setContentFitIdx] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [progress, setProgress] = useState({ current: 0, duration: 0 });
  const [retryTick, setRetryTick] = useState(0);

  const videoRef = useRef<VideoView>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryCount = useRef(0);

  const initialStream: Stream | null = current?.streams?.[streamIndex] || null;

  const initialSource = useMemo(
    () => (initialStream ? buildSource(initialStream) : null),
    // Depend on retryTick so we rebuild the source when the user asks for a retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialStream, retryTick]
  );

  const player = useVideoPlayer(initialSource, (p) => {
    p.timeUpdateEventInterval = 1;
    // Keep audio on lock-screen / bg (best-effort; still limited by expo-video).
    p.staysActiveInBackground = false;
    p.play();
  });

  const { status } = useEvent(player, "statusChange", {
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

  // Lock landscape + hide system bars for the whole time the player is mounted.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    enterImmersive();
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      exitImmersive();
    };
  }, []);

  // Some devices re-show the nav bar after user gestures. Re-hide it every time
  // the controls hide, and when playback becomes active.
  useEffect(() => {
    if (!controlsVisible) enterImmersive();
  }, [controlsVisible]);
  useEffect(() => {
    if (isPlaying) enterImmersive();
  }, [isPlaying]);

  // Intercept the hardware/gesture back button so it only closes the player
  // (and restores the system bars), instead of dropping the user in a weird
  // half-immersive state.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      exitImmersive();
      router.back();
      return true;
    });
    return () => sub.remove();
  }, [router]);

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
        autoRetryCount.current = 0;
      } catch {
        // ignore
      }
    })();
  }, [channelId, groupId]);

  // Replace source when channel/stream/retry changes
  useEffect(() => {
    const s = current?.streams?.[streamIndex];
    if (s && player) {
      player.replace(buildSource(s));
      player.play();
    }
  }, [current, streamIndex, retryTick]);

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
  // If the current source errors, try the next stream automatically (once per
  // channel round), then stop and show the error UI so the user can pick.
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
    if (autoRetryCount.current >= total) return; // exhausted, wait for user

    errorTimer.current = setTimeout(() => {
      autoRetryCount.current += 1;
      if (total > 1) {
        setStreamIndex((i) => (i + 1) % total);
      } else {
        // Only one link — bump retryTick to re-request the same URL fresh.
        setRetryTick((t) => t + 1);
      }
    }, 1500);
  }, [status, current]);

  /* ---------------------- User actions ---------------------- */

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
    autoRetryCount.current = 0;
    setControlsVisible(true);
  };

  const selectStream = (idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    autoRetryCount.current = 0;
    setStreamIndex(idx);
    setShowLinks(false);
    setControlsVisible(true);
  };

  const cycleFit = () => {
    setContentFitIdx((i) => (i + 1) % CONTAIN_MODES.length);
    scheduleHide();
  };

  const manualRetry = () => {
    autoRetryCount.current = 0;
    setRetryTick((t) => t + 1);
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
      {/* Declarative hide of both status + navigation bar (edge-to-edge). */}
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
