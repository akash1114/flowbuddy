import { useCallback } from "react";
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type NotificationTask = {
  title: string;
  scheduled_day?: string | null;
  scheduled_time?: string | null;
};

const parseTaskSchedule = (task: NotificationTask): Date | null => {
  if (!task.scheduled_day || !task.scheduled_time) {
    return null;
  }
  const [year, month, day] = task.scheduled_day.split("-").map(Number);
  const [hour, minute] = task.scheduled_time.split(":").map(Number);
  if ([year, month, day, hour, minute].some((value) => Number.isNaN(value))) {
    return null;
  }
  return new Date(year, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0, 0);
};

export function useNotifications() {
  const registerForPushNotificationsAsync = useCallback(async () => {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === "granted") {
      return true;
    }
    const requested = await Notifications.requestPermissionsAsync();
    return requested.status === "granted";
  }, []);

  const scheduleTaskReminder = useCallback(async (task: NotificationTask) => {
    const triggerDate = parseTaskSchedule(task);
    if (!triggerDate || triggerDate.getTime() <= Date.now()) {
      return null;
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Sarathi AI",
        body: `Time for: ${task.title}`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        date: triggerDate,
      },
    });
    return id;
  }, []);

  const cancelReminder = useCallback(async (notificationId: string) => {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  }, []);

  return {
    registerForPushNotificationsAsync,
    scheduleTaskReminder,
    cancelReminder,
  };
}
