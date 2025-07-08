import "./App.css";
import { Routes, Route, Navigate } from "react-router-dom";
import { GameLanding } from "./components/GameLanding";
import { GamePage } from "./components/GamePage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<GameLanding />} />
      <Route path="/game" element={<GamePage />} />
      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default App;
