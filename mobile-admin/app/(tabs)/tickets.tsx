import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import * as Haptics from "expo-haptics";
import { apiRequest, jsonBody } from "@/api";
import {
  Button,
  Card,
  ErrorNotice,
  PageHeader,
  Screen,
  StatusBadge,
} from "@/components/ui";
import { colors, formatDate, spacing } from "@/theme";
import type { ApiEnvelope } from "@/types";

type TicketEvent = {
  id: string;
  title: string;
  venue: string;
  startsAt: string;
  status: string;
  stats: { sold: number; checkedIn: number };
};

type ScanResult = {
  result:
    | "accepted"
    | "already_used"
    | "invalid_code"
    | "invalid_status"
    | "wrong_event";
  accepted: boolean;
  message: string;
  ticket?: {
    ticketNumber: string;
    status: string;
    checkedInAt?: string | null;
    buyerName?: string | null;
    eventTitle?: string | null;
  } | null;
};

export default function TicketScannerScreen() {
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [selected, setSelected] = useState<TicketEvent | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [permission, requestPermission] = useCameraPermissions();
  const scanningRef = useRef(false);
  const recentCodeRef = useRef("");

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<ApiEnvelope & { events: TicketEvent[] }>(
        "/api/admin/ticket-events",
      );
      setEvents(data.events);
      setSelected((current) =>
        current
          ? data.events.find((event) => event.id === current.id) || null
          : null,
      );
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Ticketed events could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const scan = useCallback(
    async (payload: string) => {
      if (!selected || scanningRef.current) return;
      scanningRef.current = true;
      try {
        const data = await apiRequest<ApiEnvelope & { scan: ScanResult }>(
          `/api/admin/ticket-events/${selected.id}/scan`,
          {
            method: "POST",
            ...jsonBody({ payload }),
          },
        );
        setResult(data.scan);
        setError("");
        if (data.scan.accepted) {
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          );
          setSelected((current) =>
            current
              ? {
                  ...current,
                  stats: {
                    ...current.stats,
                    checkedIn: current.stats.checkedIn + 1,
                  },
                }
              : current,
          );
        } else {
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Error,
          );
        }
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Ticket verification failed.",
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        setTimeout(() => {
          scanningRef.current = false;
        }, 900);
      }
    },
    [selected],
  );

  const onBarcodeScanned = ({ data }: BarcodeScanningResult) => {
    if (!data || data === recentCodeRef.current) return;
    recentCodeRef.current = data;
    setTimeout(() => {
      if (recentCodeRef.current === data) recentCodeRef.current = "";
    }, 2500);
    void scan(data);
  };

  if (!selected) {
    return (
      <Screen scroll>
        <PageHeader
          title="Ticket Scanner"
          subtitle="Select one event so tickets stay grouped correctly"
        />
        {error ? (
          <ErrorNotice message={error} retry={() => void loadEvents()} />
        ) : null}
        {loading ? <Text style={styles.muted}>Loading events…</Text> : null}
        {events.map((event) => (
          <Card
            key={event.id}
            onPress={() => {
              setSelected(event);
              setResult(null);
              setError("");
            }}
          >
            <View style={styles.row}>
              <Text style={styles.eventTitle}>{event.title}</Text>
              <StatusBadge value={event.status} />
            </View>
            <Text style={styles.muted}>{event.venue}</Text>
            <Text style={styles.muted}>{formatDate(event.startsAt)}</Text>
            <Text style={styles.stats}>
              {event.stats.checkedIn} checked in · {event.stats.sold} sold
            </Text>
          </Card>
        ))}
        {!loading && !events.length ? (
          <Text style={styles.muted}>
            No ticketed events have been created yet.
          </Text>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <PageHeader
        title="Scan Tickets"
        subtitle={selected.title}
        action={
          <Button
            label="Events"
            tone="ghost"
            onPress={() => {
              setSelected(null);
              setResult(null);
            }}
          />
        }
      />
      <Card>
        <View style={styles.row}>
          <View>
            <Text style={styles.eventTitle}>{selected.title}</Text>
            <Text style={styles.muted}>
              {selected.stats.checkedIn} / {selected.stats.sold} checked in
            </Text>
          </View>
          <StatusBadge value={selected.status} />
        </View>
      </Card>
      {!permission?.granted ? (
        <Card>
          <Text style={styles.eventTitle}>Camera access required</Text>
          <Text style={styles.muted}>
            Quest Admin needs camera access to read ticket QR codes.
          </Text>
          <Button
            label="Allow camera"
            onPress={() => void requestPermission()}
          />
        </Card>
      ) : (
        <View style={styles.cameraFrame}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onBarcodeScanned}
          />
          <View pointerEvents="none" style={styles.target} />
        </View>
      )}
      {error ? <ErrorNotice message={error} /> : null}
      <Card>
        <Text style={styles.label}>LATEST SCAN</Text>
        {result ? (
          <>
            <Text
              style={[
                styles.resultTitle,
                { color: result.accepted ? colors.success : colors.danger },
              ]}
            >
              {result.accepted ? "ADMIT ATTENDEE" : "DO NOT ADMIT"}
            </Text>
            <Text style={styles.message}>{result.message}</Text>
            {result.ticket ? (
              <>
                <Text style={styles.ticketNumber}>
                  {result.ticket.ticketNumber}
                </Text>
                <Text style={styles.message}>
                  {result.ticket.buyerName || "Unknown buyer"}
                </Text>
                <StatusBadge value={result.ticket.status} />
                {result.ticket.checkedInAt ? (
                  <Text style={styles.muted}>
                    First checked in {formatDate(result.ticket.checkedInAt)}
                  </Text>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <Text style={styles.muted}>
            Point the camera at a Quest ticket QR code.
          </Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  eventTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    flexShrink: 1,
  },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  stats: { color: colors.accent, fontSize: 13, fontWeight: "800" },
  cameraFrame: {
    height: 420,
    overflow: "hidden",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    position: "relative",
  },
  camera: { flex: 1 },
  target: {
    position: "absolute",
    alignSelf: "center",
    top: 75,
    width: 270,
    height: 270,
    borderWidth: 3,
    borderColor: colors.accent,
    borderRadius: 20,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  resultTitle: { fontSize: 27, lineHeight: 34, fontWeight: "900" },
  message: { color: colors.text, fontSize: 14, lineHeight: 22 },
  ticketNumber: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
});
