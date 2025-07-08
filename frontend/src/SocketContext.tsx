import React, {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import io, { Socket } from "socket.io-client";

const SocketContext = createContext<Socket | null>(null);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [socket, setSocket] = useState<Socket | null>(null);
	const socketRef = useRef<Socket | null>(null);

	useEffect(() => {
		const backendUrl =
			import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
		const newSocket = io(backendUrl, { transports: ["websocket"] });
		setSocket(newSocket);
		socketRef.current = newSocket;
		return () => {
			newSocket.disconnect();
		};
	}, []);

	return (
		<SocketContext.Provider value={socket}>
			{children}
		</SocketContext.Provider>
	);
};

export function useSocket() {
	return useContext(SocketContext);
}
