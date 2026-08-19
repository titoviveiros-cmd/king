/**
 * A coroa do KING — símbolo CONGELADO no Design System:
 * "recorte frontal em V + gema magenta, geometria icônica, legível em tamanhos pequenos".
 * Desenhada em SVG (sem asset) para servir tanto de elemento heroico do encerramento
 * quanto de marcador do campeão nas linhas do ranking.
 */
export function Crown({ size = 120, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      className={`crown ${className}`}
      width={size}
      height={size * 0.78}
      viewBox="0 0 120 94"
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="kcGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff3c4" />
          <stop offset="42%" stopColor="#f4c542" />
          <stop offset="100%" stopColor="#a87712" />
        </linearGradient>
        <linearGradient id="kcBand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe27a" />
          <stop offset="100%" stopColor="#c9971f" />
        </linearGradient>
        <radialGradient id="kcGem" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#ff9ecb" />
          <stop offset="55%" stopColor="#e0338a" />
          <stop offset="100%" stopColor="#8d1352" />
        </radialGradient>
      </defs>

      {/* corpo: três picos, com o RECORTE EM "V" no centro da frente */}
      <path
        d="M8 74 L4 20 L30 42 L46 10 L60 34 L74 10 L90 42 L116 20 L112 74 Z"
        fill="url(#kcGold)"
        stroke="#7a5510"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* aro */}
      <rect x="6" y="74" width="108" height="16" rx="6" fill="url(#kcBand)" stroke="#7a5510" strokeWidth="2.5" />
      {/* gema magenta na frente do recorte */}
      <path d="M60 34 L70 48 L60 62 L50 48 Z" fill="url(#kcGem)" stroke="#7a5510" strokeWidth="2" strokeLinejoin="round" />
      {/* pontos das hastes laterais */}
      <circle cx="4" cy="20" r="5" fill="url(#kcBand)" stroke="#7a5510" strokeWidth="2" />
      <circle cx="116" cy="20" r="5" fill="url(#kcBand)" stroke="#7a5510" strokeWidth="2" />
      <circle cx="46" cy="10" r="4.5" fill="url(#kcBand)" stroke="#7a5510" strokeWidth="2" />
      <circle cx="74" cy="10" r="4.5" fill="url(#kcBand)" stroke="#7a5510" strokeWidth="2" />
      {/* brilho de topo */}
      <path d="M14 70 L11 28 L30 45 L46 18 L58 38" stroke="rgba(255,255,255,.55)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
