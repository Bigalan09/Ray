import React from "react";

export function RayIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ray-amber" x1="320" y1="250" x2="710" y2="650" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFC83A"/>
          <stop offset="55%" stopColor="#FFA216"/>
          <stop offset="100%" stopColor="#F26A0A"/>
        </linearGradient>
      </defs>
      <path d="M336 256H585C687 256 760 317 760 408C760 476 720 528 648 552L735 688H627L554 578H438V688H336V256ZM438 344V492H574C633 492 658 454 658 418C658 375 626 344 570 344H438Z" fill="url(#ray-amber)"/>
      <path d="M714 235L741 184C746 174 759 170 768 176C777 182 779 194 772 203L734 245L714 235Z" fill="#F2B705"/>
      <path d="M757 275L815 264C826 262 834 269 835 279C836 290 829 298 818 299L758 294L757 275Z" fill="#F2B705"/>
    </svg>
  );
}
