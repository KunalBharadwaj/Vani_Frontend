// Application entry point.
// Mounts the React app into the #root element and loads global styles.
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Create the root React tree and render the top-level App component.
createRoot(document.getElementById("root")).render(<App />);