import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";

export const Intro = () => {
  const navigate = useNavigate();

  return (
    <div className="absolute z-20 inset-0 overflow-hidden">
      <main className="flex flex-col items-center justify-center min-h-[100vh] px-4 text-center">
        <h1 className="text-6xl md:text-8xl lg:text-9xl font-bold text-foreground mb-8 tracking-wider">
          Sussy Uni
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-12 leading-relaxed">
          Play online or over local wifi 4-10 players as you attempt to answer
          questions to save the campus from annihilation.
        </p>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-12 leading-relaxed">
          But beware... as there may be an student imposter on campus!
        </p>

        <Button
          variant="play"
          className="animate-pulse hover:animate-none hover:bg-white hover:scale-110 transform duration-700 ease-in-out"
          onClick={() => navigate("/waitingroom")}
        >
          PLAY NOW!
        </Button>
      </main>
    </div>
  );
};
