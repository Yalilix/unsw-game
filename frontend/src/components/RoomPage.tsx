import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSocket } from "../SocketContext";

interface Player {
	id: string;
	name: string;
}

interface RoomData {
	roomId: string;
	players: Player[];
	isHost: boolean;
	status: "waiting" | "playing";
}

const RoomPage = () => {
	const { roomId } = useParams<{ roomId: string }>();
	const navigate = useNavigate();
	const socket = useSocket();
	const [roomData, setRoomData] = useState<RoomData | null>(null);
	const [error, setError] = useState<string>("");
	const [loading, setLoading] = useState(true);
	const [copySuccess, setCopySuccess] = useState(false);
	const [editingName, setEditingName] = useState(false);
	const [newName, setNewName] = useState("");
	const [currentPlayerName, setCurrentPlayerName] = useState("");

	const PLAYER_NAME_KEY = "playerName";

	useEffect(() => {
		if (!roomId) {
			navigate("/");
			return;
		}

		if (!socket) return;

		// Check if this user created this room
		const isCreator =
			sessionStorage.getItem(`room_${roomId}_creator`) === "true";

		// Join room
		socket.emit("joinRoom", { roomId, isCreator });

		// Room joined successfully
		socket.on("roomJoined", (data: RoomData) => {
			setRoomData(data);
			setLoading(false);

			// Find current player's name
			const currentPlayer = data.players.find((p) => p.id === socket.id);
			if (currentPlayer) {
				setCurrentPlayerName(currentPlayer.name);
				setNewName(currentPlayer.name);
				// If we have a saved name and it's different, update it on the backend
				const savedName = localStorage.getItem(PLAYER_NAME_KEY);
				if (savedName && savedName !== currentPlayer.name) {
					socket.emit("updatePlayerName", { name: savedName });
				}
			}
		});

		// Player joined room
		socket.on(
			"playerJoined",
			(data: { playerId: string; playerCount: number }) => {
				setRoomData((prev) => {
					if (!prev) return prev;
					return {
						...prev,
						players: [
							...prev.players,
							{
								id: data.playerId,
								name: `Player ${prev.players.length + 1}`,
							},
						],
					};
				});
			}
		);

		// Room update event
		socket.on(
			"roomUpdate",
			(data: { playerCount: number; players: Player[] }) => {
				setRoomData((prev) => {
					if (!prev) return prev;
					return {
						...prev,
						players: data.players,
					};
				});

				// Update current player name if it changed
				const currentPlayer = data.players.find(
					(p) => p.id === socket.id
				);
				if (currentPlayer) {
					setCurrentPlayerName(currentPlayer.name);
					if (!editingName) {
						setNewName(currentPlayer.name);
					}
				}
			}
		);

		// Player left room
		socket.on(
			"playerLeft",
			(data: { playerId: string; playerCount: number }) => {
				setRoomData((prev) => {
					if (!prev) return prev;
					return {
						...prev,
						players: prev.players.filter(
							(p) => p.id !== data.playerId
						),
					};
				});
			}
		);

		// Game started
		socket.on("gameStarted", (data: { roomId: string }) => {
			// Store the socket ID for reconnection in the game
			if (socket.id) {
				sessionStorage.setItem(
					`room_${data.roomId}_originalSocketId`,
					socket.id
				);
			}
			navigate(`/game/${data.roomId}`);
		});

		// Error handling
		socket.on("error", (data: { message: string }) => {
			setError(data.message);
			setLoading(false);
		});

		return () => {
			// Only remove listeners, do not disconnect socket
			socket.off("roomJoined");
			socket.off("playerJoined");
			socket.off("roomUpdate");
			socket.off("playerLeft");
			socket.off("gameStarted");
			socket.off("error");
		};
	}, [roomId, navigate, socket]);

	const startGame = () => {
		if (socket && roomId) {
			socket.emit("startGame", { roomId });
		}
	};

	const copyRoomId = async () => {
		if (roomId) {
			try {
				await navigator.clipboard.writeText(roomId);
				setCopySuccess(true);
				setTimeout(() => setCopySuccess(false), 2000);
			} catch (err) {
				console.error("Failed to copy room ID:", err);
			}
		}
	};

	const updatePlayerName = () => {
		if (socket && newName.trim() && newName.trim() !== currentPlayerName) {
			socket.emit("updatePlayerName", { name: newName.trim() });
			localStorage.setItem(PLAYER_NAME_KEY, newName.trim());
		}
		setEditingName(false);
	};

	const cancelNameEdit = () => {
		setNewName(currentPlayerName);
		setEditingName(false);
	};

	const leaveRoom = () => {
		if (socket) {
			socket.emit("leaveRoom");
		}
		navigate("/");
	};

	if (loading) {
		return (
			<div className="min-h-screen bg-gradient-space flex items-center justify-center">
				<div className="text-white text-xl">Joining room...</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="min-h-screen bg-gradient-space flex items-center justify-center">
				<div className="bg-card p-8 rounded-lg shadow-lg max-w-md w-full mx-4">
					<h2 className="text-xl font-bold text-red-400 mb-4">
						Error
					</h2>
					<p className="text-foreground mb-6">{error}</p>
					<button
						onClick={leaveRoom}
						className="w-full bg-primary text-primary-foreground px-4 py-2 rounded hover:bg-primary/90 transition-colors"
					>
						Back to Home
					</button>
				</div>
			</div>
		);
	}

	if (!roomData) {
		return (
			<div className="min-h-screen bg-gradient-space flex items-center justify-center">
				<div className="text-white text-xl">Loading...</div>
			</div>
		);
	}

	const canStartGame = roomData.players.length >= 4 && roomData.isHost;
	const minPlayersNeeded = Math.max(0, 4 - roomData.players.length);

	return (
		<div className="min-h-screen bg-gradient-space p-4">
			<div className="max-w-2xl mx-auto">
				{/* Header */}
				<div className="bg-card p-6 rounded-lg shadow-lg mb-6">
					<h1 className="text-3xl font-bold text-foreground mb-4">
						Waiting Room
					</h1>

					{/* Room ID */}
					<div className="flex items-center gap-3 mb-4">
						<span className="text-muted-foreground">Room ID:</span>
						<code className="bg-muted px-3 py-1 rounded text-foreground font-mono text-lg">
							{roomId}
						</code>
						<button
							onClick={copyRoomId}
							className="bg-secondary text-secondary-foreground px-3 py-1 rounded hover:bg-secondary/80 transition-colors"
						>
							{copySuccess ? "Copied!" : "Copy"}
						</button>
					</div>

					{/* Status */}
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground">
							Players: {roomData.players.length}/10
						</span>
						{roomData.isHost && (
							<span className="bg-accent text-accent-foreground px-2 py-1 rounded text-sm">
								HOST
							</span>
						)}
					</div>
				</div>

				{/* Players List */}
				<div className="bg-card p-6 rounded-lg shadow-lg mb-6">
					<h2 className="text-xl font-bold text-foreground mb-4">
						Players
					</h2>
					<div className="grid grid-cols-1 gap-2">
						{roomData.players.map((player, index) => (
							<div
								key={player.id}
								className="bg-muted p-3 rounded flex items-center justify-between"
							>
								<div className="flex items-center gap-2">
									{player.id === socket?.id && editingName ? (
										<div className="flex items-center gap-2">
											<input
												type="text"
												value={newName}
												onChange={(e) =>
													setNewName(e.target.value)
												}
												onKeyDown={(e) => {
													if (e.key === "Enter")
														updatePlayerName();
													if (e.key === "Escape")
														cancelNameEdit();
												}}
												className="bg-background text-foreground px-2 py-1 rounded border border-border text-sm"
												maxLength={20}
												autoFocus
											/>
											<button
												onClick={updatePlayerName}
												className="bg-primary text-primary-foreground px-2 py-1 rounded text-xs hover:bg-primary/90"
											>
												✓
											</button>
											<button
												onClick={cancelNameEdit}
												className="bg-destructive text-destructive-foreground px-2 py-1 rounded text-xs hover:bg-destructive/90"
											>
												✕
											</button>
										</div>
									) : (
										<div className="flex items-center gap-2">
											<span className="text-foreground">
												{player.name}
											</span>
											{player.id === socket?.id && (
												<button
													onClick={() =>
														setEditingName(true)
													}
													className="text-muted-foreground hover:text-foreground text-xs"
													title="Edit name"
												>
													✏️
												</button>
											)}
										</div>
									)}
								</div>
								<div className="flex items-center gap-2">
									{player.id === socket?.id && (
										<span className="bg-accent text-accent-foreground px-2 py-1 rounded text-xs">
											YOU
										</span>
									)}
									{index === 0 && (
										<span className="bg-primary text-primary-foreground px-2 py-1 rounded text-xs">
											HOST
										</span>
									)}
								</div>
							</div>
						))}
					</div>
				</div>

				{/* Game Start Section */}
				<div className="bg-card p-6 rounded-lg shadow-lg mb-6">
					{minPlayersNeeded > 0 && (
						<div className="bg-muted p-4 rounded mb-4">
							<p className="text-muted-foreground text-center">
								Need {minPlayersNeeded} more player
								{minPlayersNeeded !== 1 ? "s" : ""} to start the
								game
							</p>
						</div>
					)}

					{roomData.isHost ? (
						<button
							onClick={startGame}
							disabled={!canStartGame}
							className={`w-full py-3 px-6 rounded font-bold transition-colors ${
								canStartGame
									? "bg-gradient-button text-primary-foreground hover:opacity-90 shadow-lg"
									: "bg-muted text-muted-foreground cursor-not-allowed"
							}`}
						>
							{canStartGame
								? "Start Game"
								: `Need ${minPlayersNeeded} More Players`}
						</button>
					) : (
						<div className="text-center text-muted-foreground">
							Waiting for host to start the game...
						</div>
					)}
				</div>

				{/* Leave Room */}
				<div className="text-center">
					<button
						onClick={leaveRoom}
						className="bg-destructive text-destructive-foreground px-6 py-2 rounded hover:bg-destructive/90 transition-colors"
					>
						Leave Room
					</button>
				</div>
			</div>
		</div>
	);
};

export default RoomPage;
