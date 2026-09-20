"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { adminRequest } from "@/lib/admin";
import { sriLankaDateTimeLocalToIso } from "@/lib/date-time";
import {
  type TicketEvent,
  type EventForm,
  type Tab,
  blankForm,
  eventToForm,
} from "./tickets/ticket-model";
import { EventGrid } from "./tickets/EventGrid";
import { EventWorkspace } from "./tickets/EventWorkspace";
import { EventEditor } from "./tickets/EventEditor";

export default function AdminTicketsManager() {
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [eventSeries, setEventSeries] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EventForm>(blankForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) || null,
    [events, selectedId],
  );

  const refresh = useCallback(async () => {
    try {
      const data = await adminRequest<{ events: TicketEvent[] }>(
        "/api/admin/ticket-events",
      );
      setEvents(data.events);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load ticketed events.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void adminRequest<{ series: Array<{ id: string; title: string }> }>(
      "/api/admin/event-series",
    )
      .then((data) => setEventSeries(data.series))
      .catch(() => setEventSeries([]));
  }, []);

  const startCreate = () => {
    setForm(blankForm);
    setEditing(true);
    setSelectedId(null);
  };
  const startEdit = () => {
    if (selected) {
      setForm(eventToForm(selected));
      setEditing(true);
    }
  };
  const save = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        startsAt: sriLankaDateTimeLocalToIso(form.startsAt),
        salesStartAt: sriLankaDateTimeLocalToIso(form.salesStartAt),
        salesEndAt: sriLankaDateTimeLocalToIso(form.salesEndAt),
        capacity: Number(form.capacity),
        maxTicketsPerOrder: Number(form.maxTicketsPerOrder),
        singlePrice: Number(form.singlePrice),
        pairPrice: Number(form.pairPrice),
        bankTransferReviewMinutes: Number(form.bankTransferReviewMinutes),
      };
      const data = await adminRequest<{ event: TicketEvent }>(
        selected
          ? `/api/admin/ticket-events/${selected.id}`
          : "/api/admin/ticket-events",
        {
          method: selected ? "PATCH" : "POST",
          json: payload,
        },
      );
      await refresh();
      setSelectedId(data.event.id);
      setEditing(false);
      setTab("overview");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Event could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell
      title="LAN Entrance Fees"
      description="Attach paid entrance passes to selected LAN events and manage their orders, QR tickets, check-ins, and reports."
      actions={
        <Button type="button" onClick={startCreate}>
          Add entrance fee
        </Button>
      }
    >
      {editing ? (
        <EventEditor
          form={form}
          setForm={setForm}
          error={error}
          saving={saving}
          isEditing={Boolean(selected)}
          eventSeries={eventSeries}
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      ) : selected ? (
        <EventWorkspace
          event={selected}
          tab={tab}
          setTab={setTab}
          onBack={() => {
            setSelectedId(null);
            setTab("overview");
          }}
          onEdit={startEdit}
          onRefresh={refresh}
        />
      ) : (
        <EventGrid
          events={events}
          loading={loading}
          error={error}
          onSelect={(id) => {
            setSelectedId(id);
            setTab("overview");
          }}
        />
      )}
    </AdminShell>
  );
}
