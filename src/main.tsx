import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import "./app/app.css";
import { AuthProvider } from "./providers/AuthProvider";
import { AppErrorBoundary } from "./lib/errors/AppErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
