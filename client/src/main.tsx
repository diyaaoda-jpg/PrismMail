import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeServiceWorker } from "./lib/serviceWorker";

// Initialize service worker for offline support
initializeServiceWorker().then((registered) => {
  if (registered) {
    console.log('Service worker registered successfully');
  } else {
    console.log('Service worker registration failed or not supported');
  }
}).catch((error) => {
  console.error('Service worker initialization error:', error);
});

createRoot(document.getElementById("root")!).render(<App />);
