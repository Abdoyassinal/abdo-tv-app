import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Dimensions,
} from "react-native";
import Video, { VideoRef } from "react-native-video";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import * as NavigationBar from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api/client"; // تأكد من المسار عندك

const { width } = Dimensions.get("window");
const HIDE_CONTROLS_AFTER_MS = 5000;
const CONTAIN_MODES = ["contain", "cover", "stretch"] as const;

type Stream = { 
  id: string; 
  url: string; 
  label?: string; 
  type?: "m3u8" | "ts" | "auto"; 
  user_agent?: string; 
  referer?: string; 
};
type Channel = { id: string; name: string; logo?: string; streams: Stream[] };

function fmt(sec: number) {
  if (!Number.isFinite(sec)) return "00:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

// اهم دالة - هي اللي بتحل مشكلة التشغيل
function buildSource(stream: Stream) {
  const headers: Record<string, string> = {
    "User-Agent": stream.user_agent || "VLC/3.0.18 LibVLC/3.0.18",
    "Referer": stream.referer || "https://iptv.com",
    "Origin": stream.referer || "https://iptv.com"
  };

  const source: any = {
    uri: stream.url,
    headers: headers,
    bufferConfig: {
      minBufferMs: 15000,
      maxBufferMs: 50000,
      bufferForPlaybackMs: 2500,
      bufferForPlaybackAfterRebufferMs: 5000
    }
  };

  // لو الرابط ts لازم نحددله النوع
  if (stream.url.includes(".ts")) {
    source.type = "ts";
  }

  return source;
}export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const videoRef = useRef<VideoRef>(null);

  const [channel, setChannel] = useState<Channel | null>(null);
  const [streamIdx, setStreamIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [contentFitIdx, setContentFitIdx] = useState(0);
  const [progress, setProgress] = useState({ current: 0, duration: 0 });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentStream = channel?.streams[streamIdx];

  // 1. اخفاء شريط التنقل + اجبار الشاشة افقي
  useEffect(() => {
    NavigationBar.setVisibility("hidden");
    NavigationBar.setPosition("absolute");
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      NavigationBar.setVisibility("visible");
      ScreenOrientation.unlockAsync();
    };
  }, []);

  // 2. جلب بيانات القناة
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const res = await api.getChannel(id);
        if (!mounted) return;
        setChannel(res);
        setStreamIdx(0);
        setPlayerError(null);
      } catch (e: any) {
        setPlayerError("فشل تحميل القناة");
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [id]);

  // 3. اخفاء الكنترول تلقائي
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), HIDE_CONTROLS_AFTER_MS);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [resetHideTimer]);

  const handleInteraction = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetHideTimer();
  }, [resetHideTimer]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>جاري التحميل...</Text>
      </View>
    );
  }

  if (!channel ||!currentStream) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>القناة غير موجودة</Text>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>رجوع</Text></Pressable>
      </View>
    );
  }

  const videoSource = buildSource(currentStream);return (
    <View style={styles.container}>
      <StatusBar hidden />

      <Pressable style={styles.videoWrap} onPress={handleInteraction}>
        <Video
          ref={videoRef}
          source={videoSource}
          style={styles.video}
          resizeMode={CONTAIN_MODES[contentFitIdx]}
          paused={!isPlaying}
          controls={false}
          useTextureView={true}
          onLoad={(data) => {
            setBuffering(false);
            setPlayerError(null);
            setProgress({ current: 0, duration: data.duration || 0 });
          }}
          onProgress={(data) => {
            setProgress({ current: data.currentTime, duration: progress.duration });
          }}
          onBuffer={({ isBuffering }) => setBuffering(isBuffering)}
          onError={(e) => {
            console.log("VIDEO ERROR:", e);
            setBuffering(false);
            setPlayerError("فشل تشغيل البث. جرب سيرفر اخر");
          }}
          onEnd={() => setIsPlaying(false)}
          repeat={true}
        />

        {/* طبقة البفر والايرور */}
        {(buffering || playerError) && (
          <View style={styles.overlay}>
            {buffering &&!playerError && (
              <View style={styles.center}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.overlayText}>جاري التحميل...</Text>
              </View>
            )}
            {playerError && (
              <View style={styles.center}>
                <MaterialIcons name="error-outline" size={48} color="#ff4d4d" />
                <Text style={styles.errorText}>{playerError}</Text>
                <Pressable style={styles.retryBtn} onPress={() => {setPlayerError(null); setBuffering(true);}}>
                  <Text style={styles.retryText}>اعادة المحاولة</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* شريط الكنترول */}
        {showControls && (
          <View style={styles.controls}>
            <View style={styles.topBar}>
              <Pressable onPress={() => router.back()}><Ionicons name="arrow-back" size={28} color="#fff" /></Pressable>
              <Text style={styles.title} numberOfLines={1}>{channel.name}</Text>
              <Pressable onPress={() => setContentFitIdx((i) => (i + 1) % 3)}>
                <MaterialIcons name="aspect-ratio" size={26} color="#fff" />
              </Pressable>
            </View>

            <View style={styles.bottomBar}>
              <Pressable onPress={() => setIsPlaying((p) =>!p)}>
                <Ionicons name={isPlaying? "pause" : "play"} size={32} color="#fff" />
              </Pressable>
              <Text style={styles.time}>{fmt(progress.current)} / {fmt(progress.duration)}</Text>
            </View>
          </View>
        )}
      </Pressable>

      {/* قائمة السيرفرات */}
      {channel.streams.length > 1 && showControls && (
        <ScrollView horizontal style={styles.serversBar}>
          {channel.streams.map((s, i) => (
            <Pressable key={s.id} style={[styles.serverBtn, i === streamIdx && styles.serverBtnActive]} onPress={() => {setStreamIdx(i); setBuffering(true); setPlayerError(null);}}>
              <Text style={styles.serverText}>{s.label || `Server ${i + 1}`}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  loadingText: {
    color: "#fff",
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    color: "#ff4d4d",
    fontSize: 16,
    textAlign: "center",
    marginTop: 8,
  },
  link: {
    color: "#4da3ff",
    fontSize: 16,
    marginTop: 12,
  },
  videoWrap: {
    flex: 1,
    backgroundColor: "#000",
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  overlayText: {
    color: "#fff",
    marginTop: 12,
    fontSize: 16,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#4da3ff",
    borderRadius: 8,
  },
  retryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  controls: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    padding: 16,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
    marginHorizontal: 12,
  },
  bottomBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  time: {
    color: "#fff",
    fontSize: 14,
  },
  serversBar: {
    maxHeight: 60,
    backgroundColor: "rgba(0,0,0,0.8)",
    paddingVertical: 8,
  },
  serverBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 6,
    backgroundColor: "#333",
    borderRadius: 6,
  },
  serverBtnActive: {
    backgroundColor: "#4da3ff",
  },
  serverText: {
    color: "#fff",
    fontSize: 14,
  },
});
