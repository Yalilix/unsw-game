import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";

export function GamePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!roomId) {
      navigate("/");
      return;
    }

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

    // Make backend URL and room ID available to game.js
    (window as any).BACKEND_URL = backendUrl;
    (window as any).ROOM_ID = roomId;

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
  }, [roomId, navigate]);

  return (
    <div className="w-screen h-screen bg-black relative">
      <canvas id="canvas" className="block"></canvas>

      {/* Action Buttons - Bottom Right */}
      <div
        className="absolute bottom-4 right-4 flex gap-3"
        style={{ zIndex: 100 }}
      >
        {/* Kill Button (only for imposters) */}
        <button
          id="killButton"
          className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors shadow-lg"
          style={{ display: "none" }}
          onClick={() => (window as any).attemptKill?.()}
        >
          KILL
        </button>

        {/* Report Button (for all players) */}
        <button
          id="reportButton"
          className="px-4 py-2 bg-yellow-600 text-white rounded-lg font-bold hover:bg-yellow-700 transition-colors shadow-lg"
          style={{ display: "none" }}
          onClick={() => (window as any).attemptReport?.()}
        >
          REPORT
        </button>
      </div>

      {/* Voting UI */}
      <div
        id="votingUI"
        className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center"
        style={{ display: "none", zIndex: 1000 }}
      >
        <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
          <h2 className="text-xl font-bold mb-4 text-center">Vote to Eject</h2>
          <div id="votingOptions" className="space-y-2">
            {/* Voting options will be populated by JavaScript */}
          </div>
          <div className="mt-4 text-center">
            <div id="voteStatus" className="text-sm text-gray-600"></div>
          </div>
        </div>
      </div>

      {/* Meeting UI */}
      <div
        id="meetingUI"
        className="absolute inset-0 bg-red-900 bg-opacity-75 flex items-center justify-center"
        style={{ display: "none", zIndex: 1000 }}
      >
        <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
          <h2 className="text-xl font-bold mb-4 text-center text-red-600">
            Emergency Meeting
          </h2>
          <div id="meetingInfo" className="text-center">
            <p>A dead body has been reported!</p>
            <p className="text-sm mt-2">
              Discuss who you think the imposter is.
            </p>
            <p className="text-sm">
              Voting will start automatically in{" "}
              <span id="meetingTimer">60</span> seconds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
