import { useEffect, useState } from "react";
import { useSocket } from "../hooks/SocketContext";

interface GameTransitionProps {
	roomId: string;
	onTransitionComplete: () => void;
}

type TransitionPhase =
	| "waiting"
	| "fadeToBlack"
	| "roleReveal"
	| "fadeToGame"
	| "complete";

export function GameTransition({
	roomId,
	onTransitionComplete,
}: GameTransitionProps) {
	const socket = useSocket();
	const [phase, setPhase] = useState<TransitionPhase>("waiting");
	const [playerRole, setPlayerRole] = useState<
		"imposter" | "crewmate" | null
	>(null);
	const [opacity, setOpacity] = useState(0);

	useEffect(() => {
		if (!socket) return;

		// Listen for game start event
		const handleGameStarted = (data: { roomId: string }) => {
			if (data.roomId === roomId) {
				console.log("Game started, beginning transition...");
				setPhase("fadeToBlack");
				setOpacity(1); // Start fading to black
			}
		};

		// Listen for game state to get player role
		const handleGameState = (data: {
			playerRole: "imposter" | "crewmate";
		}) => {
			setPlayerRole(data.playerRole);
		};

		socket.on("gameStarted", handleGameStarted);
		socket.on("gameState", handleGameState);

		return () => {
			socket.off("gameStarted", handleGameStarted);
			socket.off("gameState", handleGameState);
		};
	}, [socket, roomId]);

	useEffect(() => {
		if (phase === "fadeToBlack") {
			// Wait 3 seconds on black screen
			const timer = setTimeout(() => {
				setPhase("roleReveal");
			}, 3000);
			return () => clearTimeout(timer);
		}

		if (phase === "roleReveal") {
			// Show role for 2 seconds, then fade to game
			const timer = setTimeout(() => {
				setPhase("fadeToGame");
				setOpacity(0); // Fade out
			}, 2000);
			return () => clearTimeout(timer);
		}

		if (phase === "fadeToGame") {
			// Wait for fade out to complete, then call completion
			const timer = setTimeout(() => {
				setPhase("complete");
				onTransitionComplete();
			}, 500); // Match the CSS transition duration
			return () => clearTimeout(timer);
		}
	}, [phase, onTransitionComplete]);

	// Don't render anything until game starts
	if (phase === "waiting") {
		return null;
	}

	const roleText = playerRole?.toUpperCase() || "";
	const roleDescription =
		playerRole === "imposter"
			? "Kill everyone without getting caught"
			: "Complete all tasks and identify the imposters";

	const roleColor = playerRole === "imposter" ? "#ef4444" : "#3b82f6"; // red-500 : blue-500

	return (
		<div
			className="fixed inset-0 z-50 transition-opacity duration-500"
			style={{
				opacity,
				backgroundColor:
					phase === "fadeToBlack" ? "#000000" : "transparent",
			}}
		>
			{/* Black overlay */}
			<div
				className="absolute inset-0 bg-black transition-opacity duration-500"
				style={{
					opacity: phase === "fadeToBlack" ? 1 : 0,
				}}
			/>

			{/* Role reveal screen */}
			{phase === "roleReveal" && playerRole && (
				<div className="absolute inset-0 flex flex-col items-center justify-center bg-black">
					<div className="text-center space-y-8">
						{/* Role text */}
						<h1
							className="text-8xl font-bold tracking-wider animate-pulse"
							style={{
								color: roleColor,
								fontFamily: "DragonHunter, sans-serif",
							}}
						>
							{roleText}
						</h1>

						{/* Description */}
						<p
							className="text-2xl text-white max-w-2xl mx-auto px-4 leading-relaxed"
							style={{
								fontFamily: "DragonHunter, sans-serif",
							}}
						>
							{roleDescription}
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
