import { cn } from "../lib/utils";

interface FloatingCharacterProps {
	color: "cyan" | "red" | "purple" | "yellow" | "green" | "orange";
	position:
		| "top-left"
		| "top-right"
		| "bottom-left"
		| "bottom-right"
		| "center-left"
		| "center-right";
	size?: "sm" | "md" | "lg";
	delay?: number;
}

const positionClasses = {
	"top-left": "top-16 left-16",
	"top-right": "top-20 right-20",
	"bottom-left": "bottom-20 left-20",
	"bottom-right": "bottom-16 right-16",
	"center-left": "top-1/2 left-12 -translate-y-1/2",
	"center-right": "top-1/2 right-12 -translate-y-1/2",
};

const sizeClasses = {
	sm: "w-16 h-20",
	md: "w-20 h-24",
	lg: "w-24 h-28",
};

const colorClasses = {
	cyan: "text-cyan",
	red: "text-red",
	purple: "text-purple",
	yellow: "text-yellow",
	green: "text-green",
	orange: "text-orange",
};

export const FloatingCharacter = ({
	color,
	position,
	size = "md",
	delay = 0,
}: FloatingCharacterProps) => {
	return (
		<div
			className={cn(
				"absolute z-10 animate-float",
				positionClasses[position],
				sizeClasses[size]
			)}
			style={{ animationDelay: `${delay}s` }}
		>
			<img
				src={"/src/assets/blob.gif"}
				alt="Blob Character"
				className="w-full h-full drop-shadow-lg"
				draggable={false}
				style={{ pointerEvents: "none" }}
			/>
		</div>
	);
};
