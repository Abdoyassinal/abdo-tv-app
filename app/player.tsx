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
import Video from "react-native-video";
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
    overrideExtension: "ts",
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
  const [isLocked, setIsLocked] = useState(false);

  const videoRef = useRef<any>(null);
  const hideTimer = useRef<any>(null);

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
    if (!isLocked) {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 5000);
    }
  }, [isLocked]);

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
            controls={false}
            useTextureView={true}
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
          <ActivityIndicator size="large" color="#FFD700" />
        </View>
      )}

      {playerError && (
        <View style={styles.centerOverlay}>
          <Ionicons name="warning-outline" size={40} color="#FF3B30" />
          <Text style={styles.errorText}>Error loading stream</Text>
          {current && current.streams.length > 1 && (
            <Pressable
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
            <Pressable style={styles.backBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
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
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => switchChannel(ch)}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]} numberOfLines={1}>
                      {ch.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={[styles.centerControls, { pointerEvents: "box-none" }]}>
            {!isLocked && (
              <>
                <Pressable style={styles.ctrlBtn} onPress={() => seekBy(-10)}>
                  <MaterialIcons name="replay-10" size={32} color="#fff" />
                </Pressable>
                <Pressable style={styles.ctrlBtn} onPress={() => setShowLinks(true)}>
                  <Ionicons name="settings-outline" size={28} color="#fff" />
                </Pressable>
              </>
            )}

            <Pressable style={styles.playBtn} onPress={togglePlay}>
              <Ionicons name={isPlaying ? "pause" : "play"} size={36} color="#fff" />
            </Pressable>

            {!isLocked && (
              <>
                <Pressable style={styles.ctrlBtn} onPress={cycleFit}>
                  <MaterialIcons name="aspect-ratio" size={28} color="#fff" />
                </Pressable>
                <Pressable style={styles.ctrlBtn} onPress={() => seekBy(10)}>
                  <MaterialIcons name="forward-10" size={32} color="#fff" />
                </Pressable>
              </>
            )}

            <Pressable style={styles.lockBtn} onPress={() => setIsLocked(!isLocked)}>
              <Ionicons name={isLocked ? "lock-closed" : "lock-open-outline"} size={24} color="#fff" />
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
                  style={[styles.linkRow, idx === streamIndex && styles.linkRowActive]}
                  onPress={() => selectStream(idx)}
                >
                  <Ionicons
                    name={idx === streamIndex ? "radio-button-on" : "radio-button-off"}
                    size={20}
                    color={idx === streamIndex ? "#FFD700" : "#aaa"}
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
    backgroundColor: "#FFD700",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  errorBtnText: { color: "#000", fontWeight: "700" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(0,0,0,0.4)",
    gap: spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  pillRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm },
  pill: {
    height: 38,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  pillActive: { backgroundColor: "#FFD700", borderColor: "#FFD700" },
  pillText: { color: "#ccc", fontWeight: "600", fontSize: 14, maxWidth: 150 },
  pillTextActive: { color: "#000", fontWeight: "700" },
  centerControls: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  ctrlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  playBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.4)",
  },
  lockBtn: {
    position: "absolute",
    left: spacing.xl,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  lockBtnActive: { backgroundColor: "#FFD700" },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: "rgba(0,0,0,0.4)",
    gap: spacing.md,
  },
  timeText: { color: "#fff", fontSize: 12, fontWeight: "600", minWidth: 50, textAlign: "center" },
  seekTrack: { flex: 1, height: 30, justifyContent: "center" },
  seekBg: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" },
  seekFill: { position: "absolute", height: 4, borderRadius: 2, backgroundColor: "#FFD700" },
  seekThumb: { position: "absolute", width: 12, height: 12, borderRadius: 6, backgroundColor: "#fff", marginLeft: -6 },
  liveRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm, flex: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FF3B30" },
  liveText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  linksOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  linksSheet: {
    width: "60%",
    backgroundColor: "#1c1c1e",
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  linksTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: spacing.md, textAlign: "right" },
  linkRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  linkRowActive: { backgroundColor: "rgba(255,255,255,0.05)" },
  linkLabel: { color: "#fff", fontSize: 14, flex: 1, textAlign: "right" },
});
