import './tap-card-animation.css';

export default function TapCardAnimation() {
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 400 500"
      className="tap-card-svg"
    >
      {/* Terminal */}
      <g id="terminal">
        {/* Base */}
        <rect
          x="100"
          y="300"
          width="200"
          height="150"
          rx="8"
          fill="#1e293b"
          stroke="#334155"
          strokeWidth="2"
        />
        
        {/* Screen */}
        <rect
          x="120"
          y="320"
          width="160"
          height="80"
          rx="4"
          fill="#0f172a"
        />
        
        {/* Screen glow when tapping */}
        <rect
          x="120"
          y="320"
          width="160"
          height="80"
          rx="4"
          fill="#3b82f6"
          className="screen-glow"
        />
        
        {/* Buttons */}
        <circle cx="140" cy="430" r="8" fill="#334155" />
        <circle cx="170" cy="430" r="8" fill="#334155" />
        <circle cx="200" cy="430" r="8" fill="#22c55e" />
        <circle cx="230" cy="430" r="8" fill="#ef4444" />
        <circle cx="260" cy="430" r="8" fill="#334155" />
        
        {/* NFC symbol */}
        <g transform="translate(185, 355)">
          <path
            d="M 0,-15 Q 10,-15 10,-5"
            fill="none"
            stroke="#64748b"
            strokeWidth="2"
            strokeLinecap="round"
            className="nfc-wave"
          />
          <path
            d="M 0,-10 Q 7,-10 7,-3"
            fill="none"
            stroke="#64748b"
            strokeWidth="2"
            strokeLinecap="round"
            className="nfc-wave"
          />
          <path
            d="M 0,-5 Q 4,-5 4,-1"
            fill="none"
            stroke="#64748b"
            strokeWidth="2"
            strokeLinecap="round"
            className="nfc-wave"
          />
        </g>
        
        {/* Signal waves when tapping */}
        <circle
          cx="200"
          cy="350"
          r="30"
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          className="signal-wave"
        />
      </g>

      {/* Card */}
      <g id="card" className="card-tap">
        {/* Card body */}
        <rect
          x="80"
          y="80"
          width="240"
          height="150"
          rx="12"
          fill="url(#cardGradient)"
          stroke="#e2e8f0"
          strokeWidth="2"
        />
        
        {/* Card number dots */}
        {[0, 1, 2, 3].map((group) => (
          <g key={group}>
            {[0, 1, 2, 3].map((dot) => (
              <circle
                key={dot}
                cx={110 + group * 50 + dot * 10}
                cy={180}
                r="2"
                fill="white"
                opacity="0.8"
              />
            ))}
          </g>
        ))}
        
        {/* Contactless symbol */}
        <g transform="translate(270, 130)">
          <path
            d="M 0,-12 Q 8,-12 8,-4"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            d="M 0,-8 Q 5.5,-8 5.5,-2.5"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            d="M 0,-4 Q 3,-4 3,-1"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.9"
          />
        </g>
      </g>

      {/* Gradient definitions */}
      <defs>
        <linearGradient id="cardGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
    </svg>
  );
}