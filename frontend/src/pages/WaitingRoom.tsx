import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function isDefaultPlayerName(name: string) {
  return /^Player \d+$/.test(name);
}
const USERNAME_MIN_LENGTH = 1;
const USERNAME_MAX_LENGTH = 14;
const USERNAME_REGEX = /^[a-zA-Z0-9 ]+$/;
const PLAYER_NAME_KEY = 'playerName';

export function WaitingRoom() {
  const navigate = useNavigate();
  const [joinRoomId, setJoinRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const [nameError, setNameError] = useState('');
  const [pendingJoinRoomId, setPendingJoinRoomId] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  const createRoom = async () => {
    // Show name modal first, just like joining
    setIsCreatingRoom(true);
    setShowNameModal(true);
    setPendingName('');
    setPendingJoinRoomId(''); // Clear join room ID since we're creating
  };

  const actuallyCreateRoom = async () => {
    setLoading(true);
    setError('');

    try {
      const backendUrl =
        import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
      const response = await fetch(`${backendUrl}/api/rooms/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (data.success) {
        // Store that this user is the creator of this room
        sessionStorage.setItem(`room_${data.room.id}_creator`, 'true');
        // Store the username for the creator
        localStorage.setItem(PLAYER_NAME_KEY, pendingName.trim());
        navigate(`/room/${data.room.id}`);
      } else {
        setError(data.error || 'Failed to create room');
      }
    } catch (err) {
      setError('Failed to create room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!joinRoomId.trim()) {
      setError('Please enter a room ID');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const backendUrl =
        import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
      const response = await fetch(`${backendUrl}/api/rooms/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomId: joinRoomId.trim() }),
      });
      const data = await response.json();
      if (data.success) {
        setPendingJoinRoomId(joinRoomId.trim());
        setShowNameModal(true);
        setPendingName('');
        setLoading(false);
        return;
      } else {
        setError(data.error || 'Failed to join room');
      }
    } catch (err) {
      setError('Failed to join room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  function handleNameSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = pendingName.trim();
    if (
      trimmed.length < USERNAME_MIN_LENGTH ||
      trimmed.length > USERNAME_MAX_LENGTH
    ) {
      setNameError(
        `Name must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters.`
      );
      return;
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      setNameError('Name must be alphanumeric and spaces only.');
      return;
    }
    if (isDefaultPlayerName(trimmed)) {
      setNameError("Name cannot be a default like 'Player 1'.");
      return;
    }

    // If creating a room, just proceed with room creation
    if (isCreatingRoom) {
      setNameError('');
      setShowNameModal(false);
      setIsCreatingRoom(false);
      actuallyCreateRoom();
      return;
    }

    // If joining a room, check for duplicate name in the room
    fetch(
      `${
        import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000'
      }/api/rooms/${pendingJoinRoomId}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.room && data.room.players) {
          const taken = data.room.players.some(
            (p: any) => p.name.toLowerCase() === trimmed.toLowerCase()
          );
          if (taken) {
            setNameError('That name is already taken in this room.');
            return;
          }
        }
        setNameError('');
        setShowNameModal(false);
        localStorage.setItem(PLAYER_NAME_KEY, trimmed);
        navigate(`/room/${pendingJoinRoomId}`);
      })
      .catch(() => {
        setNameError('Failed to check for duplicate names. Please try again.');
      });
  }

  return (
    <div className="min-h-screen bg-gradient-space flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-foreground">
            Welcome to SUS1511!
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
            {loading ? 'Creating...' : 'Create Room'}
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
            <div className="flex items-center gap-2">
              <button
                onClick={joinRoom}
                disabled={loading || !joinRoomId.trim()}
                className="flex-1 bg-secondary text-secondary-foreground py-3 px-6 rounded font-bold hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Joining...' : 'Join Room'}
              </button>
            </div>
          </div>
        </div>

        {/* Game Info */}
        <div className="bg-card p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-bold text-foreground mb-2">Game Rules</h3>
          <ul className="text-muted-foreground text-sm space-y-1 pl-4 list-disc">
            <li>4-10 players required to start</li>
            <li>Use WASD or arrow keys to move around campus</li>
            <li>
              <strong>Students:</strong> Answer questions correctly to complete
              tasks and save the campus
            </li>
            <li>
              <strong>Imposters:</strong> Eliminate students and sabotage their
              mission
            </li>
            <li>
              Hold emergency meetings to discuss and vote out suspicious players
            </li>
            <li>
              Students win by completing all tasks or voting out all imposters
            </li>
            <li>
              Imposters win by eliminating enough students or sabotaging the
              campus
            </li>
          </ul>
        </div>

        {/* Footer with Art Credit */}
        <footer className="pt-8 pb-4">
          <div className="text-center text-xs text-gray-400">
            Blue blob asset made by{' '}
            <a
              href="https://cactusturtle.itch.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              cactusturtle
            </a>{' '}
            - Create and Be Merry
          </div>
        </footer>
      </div>

      {showNameModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <form
            onSubmit={handleNameSubmit}
            className="bg-card p-8 rounded-lg shadow-lg max-w-sm w-full flex flex-col gap-4"
          >
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Choose a Username
            </h2>
            <input
              type="text"
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              className="bg-input border border-border rounded px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              maxLength={USERNAME_MAX_LENGTH}
              minLength={USERNAME_MIN_LENGTH}
              autoFocus
              placeholder="Enter a username"
            />
            {nameError && (
              <div className="text-destructive text-sm">{nameError}</div>
            )}
            <button
              type="submit"
              className="bg-primary text-primary-foreground px-4 py-2 rounded font-bold hover:bg-primary/90 transition-colors"
            >
              {isCreatingRoom ? 'Create Room' : 'Join Room'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNameModal(false);
                setIsCreatingRoom(false);
                setPendingName('');
                setNameError('');
              }}
              className="bg-secondary text-secondary-foreground px-4 py-2 rounded font-bold hover:bg-secondary/80 transition-colors"
            >
              Cancel
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
