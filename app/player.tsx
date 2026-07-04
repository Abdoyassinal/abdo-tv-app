import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  StatusBar as RNStatusBar,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import Video, { VideoRef } from "react-native-video";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Haptics from "expo-haptics";
import * as NavigationBar from "expo-navigation-bar";

import { colors, spacing, radius } from "@/src/theme/colors";
import { api, Channel, Stream } from "@/src/api/client";

function buildSource(stream: Stream) {
  const headers: Record<string, string> = {
    "User-Agent": "VLC/3.0.18 LibVLC/3.0.18"
  };
  
  if (stream.user_agent) headers["User-Agent"] = stream.user_agent;
  if (stream.referer) headers["Referer"] = stream.referer;

  return {
    uri: stream.url,
    headers: headers,
    type: "ts",
    bufferConfig: {
      minBufferMs: 15000,
      maxBufferMs: 50000,
      bufferForPlaybackMs: 2500,
      bufferForPlaybackAfterRebufferMs: 5000
    }
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

const CONTAIN_MODES: ("contain" | "cover" | "stretch")[] = ["contain", "cover", "stretch"];

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
  
  const [isPlaying, setIsPlaying] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [playerError, setPlayerError] = useState(false);

  const videoRef = useRef<VideoRef>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialStream: Stream | null = current?.streams?.[streamIndex] || null;
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    RNStatusBar.setHidden(true, "fade");
    NavigationBar.setVisibilityAsync("hidden");
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      RNStatusBar.setHidden(false, "fade");
      NavigationBar.setVisibilityAsync("visible");
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setBuffering(true);
        setPlayerError(false);
        const [chs, ch] = await Promise.all([
          groupId ? api.getChannels(groupId) : Promise.resolve([]),
          api.getChannel(channelId),
        ]);
        setChannels(chs);
        setCurrent(ch);
        setStreamIndex(0);
      } catch (e) {
        setPlayerError(true);
      }
    })();
  }, [channelId, groupId]);

  useEffect(() => {
    setPlayerError(false);
    setBuffering(true);
    setIsPlaying(true);
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
    setIsPlaying(!isPlaying);
    scheduleHide();
  };

  const seekBy = (delta: number) => {
    if (videoRef.current && progress.current) {
      videoRef.current.seek(progress.current + delta);
    }
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
    if (!progress.duration || barWidth === 0 || !videoRef.current) return;
    const x = e.nativeEvent.locationX;
    const frac = Math.max(0, Math.min(1, x / barWidth));
    videoRef.current.seek(frac * progress.duration);
    scheduleHide();
  };

  const isLive = !progress.duration || progress.duration === 0;
  const fillPct = isLive ? 0 : (progress.current / progress.duration) * 100;
  return (
    <View style={styles.container}>
      <Pressable style={styles.videoTouch} onPress={toggleControls}>
        {initialStream && (
          <Video
            ref={videoRef}
            source={buildSource(initialStream)}
            style={styles.video}
            resizeMode={CONTAIN_MODES[contentFitIdx]}
            paused={!isPlaying}
            onLoad={(data) => {
              setBuffering(false);
              setProgress({ current: 0, duration: data.duration || 0 });
            }}
            onProgress={(data) => {
              setProgress({
                current: data.currentTime,
                duration: data.seekableDuration || progress.duration,
              });
            }}
            onBuffer={(data) => setBuffering(data.isBuffering)}
            onError={() => {
              setBuffering(false);
              setPlayerError(true);
            }}
          />
        )}
      </Pressable>

      {buffering && !playerError && (
        <View style={[styles.centerOverlay, { pointerEvents: "none" }]}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      )}

      {playerError && (
        <View style={styles.centerOverlay}>
          <Ionicons name="warning-outline" size={40} color={colors.error} />
          <Text style={styles.errorText}>Error loading stream</Text>
          {current && current.streams.length > 1 && (
            <Pressable
              testID="switch-stream-error"
              style={styles.errorBtn}
              onPress={() => selectStream((streamIndex + 1) % current.streams.length)}
            >
              <Text style={styles.errorBtnText}>Try another link</Text>
            </Pressable>
          )}
        </View>
      )}

      {controlsVisible && (
        <>
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
          <View style={styles.bottomBar}>
            {isLive ? (
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
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

      {showLinks && current && (
        <Pressable style={styles.linksOverlay} onPress={() => setShowLinks(false)}>
          <Pressable style={styles.linksSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.linksTitle}>{current.name}</Text>
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
                    {s.label || `Link ${idx + 1}`} · {(s.type || "auto").toUpperCase()}
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
    flexDirection: "row-reverse",
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
