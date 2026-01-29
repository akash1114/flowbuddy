import { useCallback, useEffect, useState } from "react";
import * as Calendar from "expo-calendar";
import { listTasks } from "../api/tasks";
import { normalizeDateInput, normalizeTimeInput } from "../utils/datetime";

type OccupiedMap = Record<string, string[]>;

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatTimeKey = (value: Date) => {
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

export function useTaskSchedule(userId: string | null) {
  const [occupied, setOccupied] = useState<OccupiedMap>({});

  const refresh = useCallback(async () => {
    if (!userId) {
      setOccupied({});
      return;
    }
    const today = new Date();
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 14);

    try {
      const rangeStart = new Date(today);
      rangeStart.setHours(0, 0, 0, 0);
      const rangeEnd = new Date(horizon);
      rangeEnd.setHours(23, 59, 59, 999);

      const { tasks } = await listTasks(userId, {
        status: "active",
        from: formatDateKey(today),
        to: formatDateKey(horizon),
      });
      const map: OccupiedMap = {};
      tasks.forEach((task) => {
        if (!task.scheduled_day || !task.scheduled_time) {
          return;
        }
        const dayKey = normalizeDateInput(task.scheduled_day);
        const timeKey = normalizeTimeInput(task.scheduled_time);
        if (!dayKey || !timeKey) {
          return;
        }
        const entries = map[dayKey] ? new Set(map[dayKey]) : new Set<string>();
        entries.add(timeKey);
        map[dayKey] = Array.from(entries);
      });

      const calendarBlocks = await loadCalendarConflicts(rangeStart, rangeEnd);
      Object.entries(calendarBlocks).forEach(([dayKey, slots]) => {
        const entries = map[dayKey] ? new Set(map[dayKey]) : new Set<string>();
        slots.forEach((slot) => entries.add(slot));
        map[dayKey] = Array.from(entries);
      });

      setOccupied(map);
    } catch {
      setOccupied({});
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isSlotTaken = useCallback(
    (day: string, time: string, options: { ignoreTimes?: string[] } = {}) => {
      const normalizedDay = normalizeDateInput(day);
      const normalizedTime = normalizeTimeInput(time);
      if (!normalizedDay || !normalizedTime) {
        return false;
      }
      const slots = new Set(occupied[normalizedDay] ?? []);
      if (options.ignoreTimes?.length) {
        options.ignoreTimes.forEach((slot) => {
          const normalized = normalizeTimeInput(slot);
          if (normalized) {
            slots.delete(normalized);
          }
        });
      }
      return slots.has(normalizedTime);
    },
    [occupied],
  );

  return {
    isSlotTaken,
    refresh,
  };
}

async function loadCalendarConflicts(rangeStart: Date, rangeEnd: Date): Promise<Record<string, string[]>> {
  try {
    let { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== "granted") {
      const requestResult = await Calendar.requestCalendarPermissionsAsync();
      status = requestResult.status;
    }
    if (status !== "granted") {
      return {};
    }

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const targetCalendars = calendars.filter((cal) => cal.title === "Sarathi AI" || cal.allowsModifications);
    if (!targetCalendars.length) {
      return {};
    }
    const calendarIds = targetCalendars.map((cal) => cal.id);
    const events = await Calendar.getEventsAsync(calendarIds, rangeStart, rangeEnd);
    const mapping: Record<string, Set<string>> = {};

    events.forEach((event) => {
      const start = new Date(event.startDate);
      const dayKey = formatDateKey(start);
      const timeKey = formatTimeKey(start);
      const entries = mapping[dayKey] ?? new Set<string>();
      entries.add(timeKey);
      mapping[dayKey] = entries;
    });

    const result: Record<string, string[]> = {};
    Object.entries(mapping).forEach(([day, slots]) => {
      result[day] = Array.from(slots);
    });
    return result;
  } catch {
    return {};
  }
}
