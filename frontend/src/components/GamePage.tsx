import { useEffect } from "react";

export function GamePage() {
  useEffect(() => {
    // Promise-based loader that ensures the script fires its onload before resolving.
    function loadScript(src: string, id?: string): Promise<HTMLScriptElement> {
      return new Promise((resolve) => {
        let script: HTMLScriptElement | null = id
          ? (document.getElementById(id) as HTMLScriptElement | null)
          : null;
        if (script && script.getAttribute("data-loaded") === "true") {
          // Already loaded
          return resolve(script);
        }
        if (!script) {
          script = document.createElement("script");
          script.src = src;
          if (id) script.id = id;
          script.async = true;
          document.body.appendChild(script);
        }
        script.onload = () => {
          script!.setAttribute("data-loaded", "true");
          resolve(script!);
        };
      });
    }

    const backendUrl =
      import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

    // Make it available to game.js
    (window as any).BACKEND_URL = backendUrl;

    // Load in sequence so that socket.io is available before game.js executes
    (async () => {
      try {
        await loadScript(`${backendUrl}/socket.io/socket.io.js`, "socket-io");
        await loadScript("/game.js", "unsw-game");
      } catch (err) {
        console.error("Failed to load game scripts", err);
      }
    })();

    return () => {};
  }, []);

  return (
    <div className="w-screen h-screen">
      <canvas id="canvas" className="block"></canvas>
    </div>
  );
}
