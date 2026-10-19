import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";

// Un rappel qui tombe pendant qu'on utilise l'application s'affiche aussi.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Toucher un rappel ouvre directement l'idée concernée. */
export function ReminderOpener() {
  const router = useRouter();

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const id = response?.notification.request.content.data?.bookmarkId;
      if (typeof id === "string") router.push(`/bookmark/${id}`);
    };
    // Application lancée par le toucher sur la notification.
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);

  return null;
}
