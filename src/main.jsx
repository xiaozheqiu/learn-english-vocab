import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

if ("caches" in window) caches.keys().then((names) => Promise.all(names.filter((name) => /^ox5000-/.test(name)).map((name) => caches.delete(name)))).catch(() => {});
createRoot(document.getElementById("app")).render(<React.StrictMode><App /></React.StrictMode>);
