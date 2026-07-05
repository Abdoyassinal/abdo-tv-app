import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  StatusBar as RNStatusBar,
  Linking,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Haptics from "expo-haptics";
import * as NavigationBar from "expo-navigation-bar";
import { useKeepAwake } from "expo-keep-awake";

import { spacing, radius, colors } from "@/src/theme/colors";
import { api, Channel, Stream } from "@/src/api/client";
export default function PlayerScreen() {
  const router = useRouter();
  const { channelId, groupId } = useLocalSearchParams<{ channelId: string; groupId: string }>();

  useKeepAwake();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [current, setCurrent] = useState<Channel | null>(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [showLinks, setShowLinks] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const initialStream: Stream | null = current?.streams?.[streamIndex] || null;

  // الدالة التي ترسل الرابط لمشغلات الهاتف الخارجية غصب عن الأندرويد
  const playInExternalPlayer = async (url: string) => {
    if (!url) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      // فتح قائمة هوية الأندرويد لاختيار المشغل (VLC, MX Player, etc.)
      const supported = await Linking.canOpenURL(url);
      
      // نقوم بفتح الرابط مباشرة عبر مشغل النظام
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert(
        "تنبيه",
        "تأكد من تثبيت مشغل فيديو خارجي على هاتفك مثل VLC أو MX Player لتشغيل القناة بنجاح."
      );
    }
  };

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
        const [chs, ch] = await Promise.all([
          groupId ? api.getChannels(groupId) : Promise.resolve([]),
          api.getChannel(channelId),
        ]);
        setChannels(chs);
        setCurrent(ch);
        setStreamIndex(0);
        
        // تشغيل القناة تلقائياً فور فتح الشاشة عبر المشغل الخارجي
        if (ch?.streams?.[0]?.url) {
          playInExternalPlayer(ch.streams[0].url);
        }
      } catch {
        // ignore
      }
    })();
  }, [channelId, groupId]);

  const switchChannel = (ch: Channel) => {
    if (ch.id === current?.id) return;
    if (!ch.streams || ch.streams.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCurrent(ch);
    setStreamIndex(0);
    if (ch.streams[0]?.url) {
      playInExternalPlayer(ch.streams[0].url);
    }
  };

  const selectStream = (idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStreamIndex(idx);
    setShowLinks(false);
    if (current?.streams?.[idx]?.url) {
      playInExternalPlayer(current.streams[idx].url);
    }
  };
  return (
    <View style={styles.container}>
      <Pressable style={styles.videoTouch} onPress={() => setControlsVisible(!controlsVisible)}>
        <View style={styles.centerOverlay}>
          <Ionicons name="play-circle-outline" size={80} color="#FFD700" />
          <Text style={styles.mainTitle}>{current?.name || "جاري جلب القناة..."}</Text>
          <Pressable 
            style={styles.mainPlayBtn} 
            onPress={() => initialStream?.url && playInExternalPlayer(initialStream.url)}
          >
            <Ionicons name="logo-playstation" size={20} color="#000" style={{ marginRight: 8 }} />
            <Text style={styles.mainPlayBtnText}>تشغيل عبر مشغل خارجي (VLC / MX)</Text>
          </Pressable>
        </View>
      </Pressable>

      {controlsVisible && (
        <View style={styles.topBar}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {channels.map((ch) => {
              const active = ch.id === current?.id;
              return (
                <Pressable key={ch.id} style={[styles.pill, active && styles.pillActive]} onPress={() => switchChannel(ch)}>
                  <Text style={[styles.pillText, active && styles.pillTextActive]} numberOfLines={1}>
                    {ch.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={styles.settingsBtn} onPress={() => setShowLinks(true)}>
            <Ionicons name="settings-outline" size={24} color="#fff" />
          </Pressable>
        </View>
      )}

      {showLinks && current && (
        <Pressable style={styles.linksOverlay} onPress={() => setShowLinks(false)}>
          <Pressable style={styles.linksSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.linksTitle}>{current.name} — اختر السيرفر</Text>
            <ScrollView style={{ maxHeight: 220 }}>
              {current.streams.map((s, idx) => (
                <Pressable key={s.id} style={[styles.linkRow, idx === streamIndex && styles.linkRowActive]} onPress={() => selectStream(idx)}>
                  <Ionicons name={idx === streamIndex ? "radio-button-on" : "radio-button-off"} size={20} color={idx === streamIndex ? "#FFD700" : "#aaa"} />
                  <Text style={styles.linkLabel}>
                    {s.label || `رابط البديل ${idx + 1}`} · {(s.type || "auto").toUpperCase()}
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
  container: { flex: 1, backgroundColor: "#111" },
  videoTouch: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" },
  centerOverlay: { alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  mainTitle: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center" },
  mainPlayBtn: { flexDirection: "row-reverse", alignItems: "center", backgroundColor: "#FFD700", paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, marginTop: spacing.md },
  mainPlayBtnText: { color: "#000", fontWeight: "700", fontSize: 15 },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row-reverse", alignItems: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: "rgba(0,0,0,0.6)", gap: spacing.md },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  settingsBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  pillRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm },
  pill: { height: 38, justifyContent: "center", paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  pillActive: { backgroundColor: "#FFD700", borderColor: "#FFD700" },
  pillText: { color: "#ccc", fontWeight: "600", fontSize: 14, maxWidth: 150 },
  pillTextActive: { color: "#000", fontWeight: "700" },
  linksOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" },
  linksSheet: { width: "60%", backgroundColor: "#1c1c1e", borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  linksTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: spacing.md, textAlign: "right" },
  linkRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  linkRowActive: { backgroundColor: "rgba(255,255,255,0.05)" },
  linkLabel: { color: "#fff", fontSize: 14, flex: 1, textAlign: "right" },
});
