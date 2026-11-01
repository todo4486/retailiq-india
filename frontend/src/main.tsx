import { MotionConfig } from "motion/react";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./services/AuthContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* "user" removes movement for people who have asked their system to reduce motion. */}
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </MotionConfig>
  </React.StrictMode>,
);
