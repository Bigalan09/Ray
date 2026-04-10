import React, { useState, useEffect } from "react";

const frames = ['·', '∗', '✱', '✳', '✱', '∗'];

export function ThinkingAnimation() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, 150);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="inline-block bg-[var(--bg-surface)] p-2.5 rounded-lg">
      <div className="font-mono text-2xl text-white flex items-center justify-center transition-all duration-150 select-none">
        {frames[frame]}
      </div>
    </div>
  );
}
