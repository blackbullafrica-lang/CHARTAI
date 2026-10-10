type PatternThumbnailProps = {
  name: string;
  direction: "bullish" | "bearish" | "neutral";
};

const lines: Record<string, string> = {
  "Double top": "4,25 11,11 18,23 27,10 36,24 50,29",
  "Double bottom": "4,7 12,22 20,10 29,23 38,9 51,4",
  "Head and shoulders": "3,26 10,16 17,23 26,5 35,23 43,16 52,27",
  "Inverse head and shoulders": "3,6 10,16 17,9 26,27 35,9 43,16 52,5",
  "Ascending triangle": "4,25 12,9 20,21 28,9 36,16 44,9 52,11",
  "Descending triangle": "4,7 12,22 20,12 28,22 36,17 44,22 52,20",
  "Symmetrical triangle": "4,6 12,25 20,10 28,22 36,14 44,19 52,16",
  "Rising wedge": "4,27 12,12 20,24 29,10 38,20 51,8",
  "Falling wedge": "4,5 12,20 20,8 29,22 38,12 51,24",
  "Bull flag": "4,27 13,5 17,15 26,11 34,18 43,14 52,19",
  "Bear flag": "4,5 13,27 17,17 26,21 34,14 43,18 52,13",
};

export function PatternThumbnail({ name, direction }: PatternThumbnailProps) {
  const points = lines[name] || "4,25 13,9 22,20 31,11 40,18 52,7";
  const tone =
    direction === "bullish"
      ? "#49d4a4"
      : direction === "bearish"
        ? "#eb7b85"
        : "#d0b46f";

  return (
    <svg
      className="pattern-thumbnail"
      viewBox="0 0 56 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0.5" y="0.5" width="55" height="31" rx="5" />
      <path className="pattern-grid" d="M1 11H55M1 21H55M19 1V31M37 1V31" />
      <polyline points={points} stroke={tone} />
      {(name === "Double top" || name === "Head and shoulders") && (
        <path className="pattern-guide" d="M5 24H51" />
      )}
      {(name === "Double bottom" || name === "Inverse head and shoulders") && (
        <path className="pattern-guide" d="M5 8H51" />
      )}
      {name.includes("triangle") && (
        <path
          className="pattern-guide"
          d={
            name === "Ascending triangle"
              ? "M5 9H52M5 27L52 11"
              : name === "Descending triangle"
                ? "M5 5L52 20M5 22H52"
                : "M5 5L52 17M5 27L52 17"
          }
        />
      )}
      {name.includes("wedge") && (
        <path
          className="pattern-guide"
          d={name === "Rising wedge" ? "M4 27L52 8M4 14L52 7" : "M4 5L52 24M4 18L52 23"}
        />
      )}
      {name.includes("flag") && (
        <path
          className="pattern-guide"
          d={name === "Bull flag" ? "M13 5V27M16 14L51 18M18 8L52 13" : "M13 5V27M16 18L51 14M18 24L52 19"}
        />
      )}
    </svg>
  );
}
