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
      if (!response) return;
      // Sans cela, la dernière notification touchée — celle de la mise à
      // jour — était rejouée à chaque ouverture, partages compris : on
      // atterrissait sur l'écran de mise à jour au lieu de revenir à
      // Instagram.
      Notifications.clearLastNotificationResponse();
      const data = response.notification.request.content.data;
      const id = data?.bookmarkId;
      if (typeof id === "string") router.push(`/bookmark/${id}`);
      // Notification de mise à jour : l'écran qui l'installe.
      if (data?.route === "/settings/update") router.push("/settings/update");
    };
    // Application lancée par le toucher sur la notification.
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);

  return null;
}
