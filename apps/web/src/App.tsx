import { useEffect, useState } from "react";

type ApiStatus = "checking" | "up" | "down";

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((response) => setApiStatus(response.ok ? "up" : "down"))
      .catch(() => setApiStatus("down"));
  }, []);

  return (
    <main>
      <h1>Dragonpunchedle</h1>
      <p>API: {apiStatus}</p>
    </main>
  );
}
