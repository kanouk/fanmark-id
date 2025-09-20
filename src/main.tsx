import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Force DaisyUI Pastel theme
document.documentElement.setAttribute('data-theme', 'pastel');

createRoot(document.getElementById("root")!).render(<App />);
