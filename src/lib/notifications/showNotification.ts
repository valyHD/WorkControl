function navigateToPath(path: string) {
  if (typeof window === "undefined") return;
  window.focus();
  window.location.assign(path);
}

export async function showBrowserNotification(title: string, body: string, path?: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const destinationPath = path ?? "/notifications";

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();

    if (registration) {
      await registration.showNotification(title, {
        body,
        data: {
          path: destinationPath,
        },
      });
      return;
    }
  }

  const notification = new Notification(title, {
    body,
    data: {
      path: destinationPath,
    },
  });

  notification.onclick = (event) => {
    event.preventDefault();
    navigateToPath(destinationPath);
  };
}
