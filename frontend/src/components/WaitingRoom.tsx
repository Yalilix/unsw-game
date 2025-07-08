import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function WaitingRoom() {
  const navigate = useNavigate();
  const [joinRoomId, setJoinRoomId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const createRoom = async () => {
    setLoading(true);
    setError("");

    try {
      const backendUrl =
        import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
      const response = await fetch(`${backendUrl}/api/rooms/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (data.success) {
        // Store that this user is the creator of this room
        sessionStorage.setItem(`room_${data.room.id}_creator`, "true");
        navigate(`/room/${data.room.id}`);
      } else {
        setError(data.error || "Failed to create room");
      }
    } catch (err) {
      setError("Failed to create room. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!joinRoomId.trim()) {
      setError("Please enter a room ID");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const backendUrl =
        import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
      const response = await fetch(`${backendUrl}/api/rooms/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomId: joinRoomId.trim() }),
      });

      const data = await response.json();

      if (data.success) {
        navigate(`/room/${data.room.id}`);
      } else {
        setError(data.error || "Failed to join room");
      }
    } catch (err) {
      setError("Failed to join room. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-space flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-foreground">
            Welcome to Sussy Uni!
          </h1>
          <p className="text-muted-foreground">
            Create or join a room to start playing
          </p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg">
            {error}
          </div>
        )}

        {/* Create Room Section */}
        <div className="bg-card p-6 rounded-lg shadow-lg space-y-4">
          <h2 className="text-xl font-bold text-foreground">Create New Room</h2>
          <p className="text-muted-foreground text-sm">
            Start a new game and invite friends to join
          </p>
          <button
            onClick={createRoom}
            disabled={loading}
            className="w-full bg-gradient-button text-primary-foreground py-3 px-6 rounded font-bold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            {loading ? "Creating..." : "Create Room"}
          </button>
        </div>

        {/* Join Room Section */}
        <div className="bg-card p-6 rounded-lg shadow-lg space-y-4">
          <h2 className="text-xl font-bold text-foreground">
            Join Existing Room
          </h2>
          <p className="text-muted-foreground text-sm">
            Enter a room ID to join a friend's game
          </p>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Enter Room ID (e.g., ABC123)"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
              className="w-full bg-input border border-border rounded px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              maxLength={6}
            />
            <button
              onClick={joinRoom}
              disabled={loading || !joinRoomId.trim()}
              className="w-full bg-secondary text-secondary-foreground py-3 px-6 rounded font-bold hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Joining..." : "Join Room"}
            </button>
          </div>
        </div>

        {/* Game Info */}
        <div className="bg-card p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-bold text-foreground mb-2">Game Rules</h3>
          <ul className="text-muted-foreground text-sm space-y-1">
            <li>• 4-10 players required to start</li>
            <li>• Use WASD or arrow keys to move around campus</li>
            <li>
              • <strong>Students:</strong> Answer questions correctly to
              complete tasks and save the campus
            </li>
            <li>
              • <strong>Imposters:</strong> Eliminate students and sabotage
              their mission
            </li>
            <li>
              • Hold emergency meetings to discuss and vote out suspicious
              players
            </li>
            <li>
              • Students win by completing all tasks or voting out all imposters
            </li>
            <li>
              • Imposters win by eliminating enough students or sabotaging the
              campus
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
