import React from "react";
import ReactDOM from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import App from "./App";
import "./fonts.css";
import "./index.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <IconContext.Provider value={{ size: 16, weight: "regular", "aria-hidden": true, focusable: false }}>
        <App />
      </IconContext.Provider>
    </React.StrictMode>
  );
}
