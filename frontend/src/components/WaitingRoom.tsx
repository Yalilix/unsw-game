import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

function isDefaultPlayerName(name: string) {
	return /^Player \d+$/.test(name);
}
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 16;
const USERNAME_REGEX = /^[a-zA-Z0-9 ]+$/;
const PLAYER_NAME_KEY = "playerName";

export function WaitingRoom() {
	const navigate = useNavigate();
	const [joinRoomId, setJoinRoomId] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [showNameModal, setShowNameModal] = useState(false);
	const [pendingName, setPendingName] = useState("");
	const [nameError, setNameError] = useState("");
	const [pendingJoinRoomId, setPendingJoinRoomId] = useState("");

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
		// Prompt for name if not set or is default
		let savedName = localStorage.getItem(PLAYER_NAME_KEY) || "";
		if (!savedName || isDefaultPlayerName(savedName)) {
			setPendingJoinRoomId(joinRoomId.trim());
			setShowNameModal(true);
			setPendingName("");
			return;
		}
		await doJoinRoom(joinRoomId.trim(), savedName);
	};

	async function doJoinRoom(roomId: string, name: string) {
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
				body: JSON.stringify({ roomId }),
			});
			const data = await response.json();
			if (data.success) {
				localStorage.setItem(PLAYER_NAME_KEY, name);
				navigate(`/room/${data.room.id}`);
			} else {
				setError(data.error || "Failed to join room");
			}
		} catch (err) {
			setError("Failed to join room. Please try again.");
		} finally {
			setLoading(false);
		}
	}

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
			setNameError("Name must be alphanumeric and spaces only.");
			return;
		}
		if (isDefaultPlayerName(trimmed)) {
			setNameError("Name cannot be a default like 'Player 1'.");
			return;
		}
		setNameError("");
		setShowNameModal(false);
		doJoinRoom(pendingJoinRoomId, trimmed);
	}

	return (
		<div className="min-h-screen bg-gradient-space flex items-center justify-center p-4">
			<div className="max-w-md w-full space-y-6">
				{/* Header */}
				<div className="text-center space-y-2">
					<h1 className="text-4xl font-bold text-foreground">
						Welcome to Sussy UNSW!
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
					<h2 className="text-xl font-bold text-foreground">
						Create New Room
					</h2>
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
							onChange={(e) =>
								setJoinRoomId(e.target.value.toUpperCase())
							}
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
					<h3 className="text-lg font-bold text-foreground mb-2">
						Game Rules
					</h3>
					<ul className="text-muted-foreground text-sm space-y-1">
						<li>• Minimum 4 players required to start</li>
						<li>• Maximum 10 players per room</li>
						<li>• Use WASD to move around</li>
						<li>
							• Press SPACE to if you are an impostor to eliminate
							other players
						</li>
						<li>• Find and eliminate other players!</li>
					</ul>
				</div>
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
							<div className="text-destructive text-sm">
								{nameError}
							</div>
						)}
						<button
							type="submit"
							className="bg-primary text-primary-foreground px-4 py-2 rounded font-bold hover:bg-primary/90 transition-colors"
						>
							Join Room
						</button>
					</form>
				</div>
			)}
		</div>
	);
}
