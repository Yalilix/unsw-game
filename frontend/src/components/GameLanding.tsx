import { Link } from "react-router-dom";

export function GameLanding() {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <h1 className="text-3xl font-bold">Welcome to Sussy UNSW!</h1>
      <Link
        to="/game"
        className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700"
      >
        Enter Game
      </Link>
    </div>
  );
}
