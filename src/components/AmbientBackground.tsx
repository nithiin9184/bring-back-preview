export function AmbientBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      <div
        className="absolute -top-[18%] -left-[15%] h-[62vh] w-[62vh] rounded-full bg-peach opacity-35 blur-[90px]"
        style={{ animation: "drift-a 46s ease-in-out infinite" }}
      />
      <div
        className="absolute top-[22%] -right-[20%] h-[58vh] w-[58vh] rounded-full bg-blush opacity-30 blur-[100px]"
        style={{ animation: "drift-b 58s ease-in-out infinite" }}
      />
      <div
        className="absolute -bottom-[18%] left-[5%] h-[60vh] w-[60vh] rounded-full bg-sky opacity-35 blur-[95px]"
        style={{ animation: "drift-c 52s ease-in-out infinite" }}
      />
    </div>
  );
}
