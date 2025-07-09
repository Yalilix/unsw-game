import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  enterRoom,
  leaveRoom,
  muteLocalAudio,
  unmuteLocalAudio,
} from '../components/Agora';

// Extend Window interface to include our custom properties
declare global {
  interface Window {
    BACKEND_URL: string;
    ROOM_ID: string;
    attemptSabotage?: () => void;
    attemptKill?: () => void;
    attemptTask?: () => void;
    attemptReport?: () => void;
  }
}

export function GamePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [isVotingVisible, setIsVotingVisible] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (!roomId) {
      navigate('/');
      return;
    }

    // Promise-based loader that ensures the script fires its onload before resolving.
    function loadScript(src: string, id?: string): Promise<HTMLScriptElement> {
      return new Promise((resolve) => {
        let script: HTMLScriptElement | null = id
          ? (document.getElementById(id) as HTMLScriptElement | null)
          : null;
        if (script && script.getAttribute('data-loaded') === 'true') {
          // Already loaded
          return resolve(script);
        }
        if (!script) {
          script = document.createElement('script');
          script.src = src;
          if (id) script.id = id;
          script.async = true;
          document.body.appendChild(script);
        }
        script.onload = () => {
          script!.setAttribute('data-loaded', 'true');
          resolve(script!);
        };
      });
    }

    const backendUrl =
      import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

    // Make backend URL and room ID available to game.js
    window.BACKEND_URL = backendUrl;
    window.ROOM_ID = roomId;

    // Load in sequence so that socket.io is available before game.js executes
    (async () => {
      try {
        await loadScript(`${backendUrl}/socket.io/socket.io.js`, 'socket-io');
        await loadScript('/game.js', 'sussy-uni-game');
      } catch (err) {
        console.error('Failed to load game scripts', err);
      }
    })();

    // Agora voice chat integration: observe voting UI visibility
    const votingUI = document.getElementById('votingUI');
    let prevDisplay = votingUI?.style.display;
    let joined = false;
    let observer: MutationObserver | null = null;
    if (votingUI) {
      observer = new MutationObserver(() => {
        const currentDisplay = votingUI.style.display;
        if (currentDisplay !== prevDisplay) {
          if (currentDisplay !== 'none' && !joined) {
            enterRoom();
            joined = true;
            setIsVotingVisible(true);
          } else if (currentDisplay === 'none' && joined) {
            leaveRoom();
            joined = false;
            setIsVotingVisible(false);
            setIsMuted(false); // reset mute state
          }
          prevDisplay = currentDisplay;
        }
      });
      observer.observe(votingUI, {
        attributes: true,
        attributeFilter: ['style'],
      });
    }

    return () => {
      observer?.disconnect();
      if (joined) leaveRoom();
    };
  }, [roomId, navigate]);

  // Handle mute/unmute toggle
  const handleMuteToggle = () => {
    if (isMuted) {
      unmuteLocalAudio();
      setIsMuted(false);
    } else {
      muteLocalAudio();
      setIsMuted(true);
    }
  };

  return (
    <div className="w-screen h-screen bg-black relative overflow-hidden">
      <canvas id="canvas" className="block"></canvas>

      {/* Action Buttons - Bottom Right */}
      <div
        className="absolute bottom-4 right-4 flex gap-3"
        style={{ zIndex: 100 }}
      >
        {/* Sabotage Button (only for imposters) */}
        <button
          id="sabotageButton"
          className="px-4 py-2 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition-colors shadow-lg cursor-pointer"
          style={{ display: 'none' }}
          onClick={() => window.attemptSabotage?.()}
        >
          SABOTAGE
        </button>

        {/* Kill Button (only for imposters) */}
        <button
          id="killButton"
          className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors shadow-lg cursor-pointer"
          style={{ display: 'none' }}
          onClick={() => window.attemptKill?.()}
        >
          KILL
        </button>

        {/* Task Button (only for students) */}
        <button
          id="taskButton"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-lg cursor-pointer"
          style={{ display: 'none' }}
          onClick={() => window.attemptTask?.()}
        >
          DO TASK
        </button>

        {/* Report Button (for all players) */}
        <button
          id="reportButton"
          className="px-4 py-2 bg-yellow-600 text-white rounded-lg font-bold hover:bg-yellow-700 transition-colors shadow-lg cursor-pointer"
          style={{ display: 'none' }}
          onClick={() => window.attemptReport?.()}
        >
          REPORT
        </button>
      </div>

      {/* Voting UI */}
      <div
        id="votingUI"
        className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center"
        style={{ display: 'none', zIndex: 1000 }}
      >
        {/* Mute/Unmute Button */}
        {isVotingVisible && (
          <button
            onClick={handleMuteToggle}
            className={`absolute top-4 right-4 px-4 py-2 rounded font-bold transition-colors ${
              isMuted
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
            style={{ zIndex: 1100 }}
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
        )}
        <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4 border-2 border-gray-600 max-h-[90vh] overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-center text-white">
            Vote to Eject
          </h2>
          <div className="text-center mb-4">
            <p className="text-sm text-gray-200">
              Time remaining:{' '}
              <span id="votingTimer" className="font-bold text-yellow-400">
                59
              </span>{' '}
              seconds
            </p>
          </div>
          <div id="votingOptions" className="space-y-2">
            {/* Voting options will be populated by JavaScript */}
          </div>
          <div className="mt-4 text-center">
            <div id="voteStatus" className="text-sm text-gray-200"></div>
          </div>
        </div>
      </div>

      {/* Meeting UI */}
      <div
        id="meetingUI"
        className="absolute inset-0 bg-red-900 bg-opacity-75 flex items-center justify-center"
        style={{ display: 'none', zIndex: 1000 }}
      >
        <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-center text-red-600">
            Emergency Meeting
          </h2>
          <div id="meetingInfo" className="text-center">
            <p>A dead body has been reported!</p>
            <p className="text-sm mt-2">
              Discuss who you think the imposter is.
            </p>
            <p className="text-sm">
              Voting will start automatically in{' '}
              <span id="meetingTimer">60</span> seconds.
            </p>
          </div>
        </div>
      </div>

      {/* Voting Results UI */}
      <div
        id="votingResultsUI"
        className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center"
        style={{ display: 'none', zIndex: 1000 }}
      >
        <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4 border-2 border-gray-600 max-h-[90vh] overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-center text-white">
            Voting Results
          </h2>
          <div
            id="votingResultsContent"
            className="text-center text-gray-200 mb-4"
          >
            {/* Results will be populated by JavaScript */}
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-300">
              Game continues in{' '}
              <span id="continueTimer" className="font-bold text-yellow-400">
                5
              </span>{' '}
              seconds
            </p>
          </div>
        </div>
      </div>

      {/* Game End UI */}
      <div
        id="gameEndUI"
        className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center"
        style={{ display: 'none', zIndex: 1000 }}
      >
        <div className="bg-gray-800 p-6 rounded-lg max-w-lg w-full mx-4 border-2 border-gray-600 max-h-[90vh] overflow-y-auto">
          <h2
            id="gameEndTitle"
            className="text-2xl font-bold mb-4 text-center text-white"
          >
            Game Over
          </h2>
          <div id="gameEndContent" className="text-center text-gray-200 mb-6">
            {/* Game end content will be populated by JavaScript */}
          </div>
          <div className="flex flex-col gap-3">
            <button
              id="goToLobbyButton"
              className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold transition-colors cursor-pointer"
            >
              Go to Lobby
            </button>
            <button
              id="exitGameButton"
              className="w-full py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-bold transition-colors cursor-pointer"
            >
              Exit Game
            </button>
          </div>
        </div>
      </div>

      {/* Task Modal */}
      <div
        id="taskModal"
        className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center"
        style={{ display: 'none', zIndex: 1000 }}
      >
        <div className="bg-gray-800 p-6 rounded-lg max-w-lg w-full mx-4 border-2 border-gray-600 max-h-[90vh] overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-center text-white">
            Complete Task
          </h2>
          <div
            id="taskQuestion"
            className="text-center text-gray-200 mb-6 text-lg"
          >
            {/* Question will be populated by JavaScript */}
          </div>
          <div id="taskOptions" className="space-y-2">
            {/* Options will be populated by JavaScript */}
          </div>
        </div>
      </div>

      {/* Sabotage Modal */}
      <div
        id="sabotageModal"
        className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center"
        style={{ display: 'none', zIndex: 1000 }}
      >
        <div className="bg-red-900 p-6 rounded-lg max-w-lg w-full mx-4 border-2 border-red-600 max-h-[90vh] overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-center text-white">
            🔥 Sabotage Systems
          </h2>
          <div
            id="sabotageQuestion"
            className="text-center text-gray-200 mb-6 text-lg"
          >
            {/* Question will be populated by JavaScript */}
          </div>
          <div id="sabotageOptions" className="space-y-2">
            {/* Options will be populated by JavaScript */}
          </div>
        </div>
      </div>

      {/* Repair Modal */}
      <div
        id="repairModal"
        className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center"
        style={{ display: 'none', zIndex: 1000 }}
      >
        <div className="bg-blue-900 p-6 rounded-lg max-w-lg w-full mx-4 border-2 border-blue-600 max-h-[90vh] overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-center text-white">
            ⚡ Fix Lights
          </h2>
          <div
            id="repairQuestion"
            className="text-center text-gray-200 mb-6 text-lg"
          >
            {/* Question will be populated by JavaScript */}
          </div>
          <div id="repairOptions" className="space-y-2">
            {/* Options will be populated by JavaScript */}
          </div>
        </div>
      </div>
    </div>
  );
}
