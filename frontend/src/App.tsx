import "./App.css";
import { Routes, Route, Navigate } from "react-router-dom";
import { GameLanding } from "./components/GameLanding";
import { GamePage } from "./components/GamePage";
import RoomPage from "./components/RoomPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<GameLanding />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      <Route path="/game/:roomId" element={<GamePage />} />
      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default App;
