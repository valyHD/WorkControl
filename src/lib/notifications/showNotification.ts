export function showBrowserNotification(title: string, body: string, path?: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const notification = new Notification(title, {
    body,
    data: {
      path: path ?? "/notifications",
    },
  });

  notification.onclick = (event) => {
    event.preventDefault();
    const destinationPath = String(notification.data?.path || "/notifications");

    if (typeof window !== "undefined") {
      window.focus();
      window.location.assign(destinationPath);
    }
  };
}
