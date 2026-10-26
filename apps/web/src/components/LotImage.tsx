import { useState } from "react";
import "./LotImage.css";

// Imagem IIIF carregada direto pelo BROWSER do usuário (nunca pelo nosso backend:
// o host do museu bloqueia IPs de datacenter). Se falhar, aparece o fallback do
// Figma ("Imagem indisponível"): a vitrine e a sala continuam funcionando.
export function LotImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const classes = ["lot-image", className].filter(Boolean).join(" ");

  if (!src || failed) {
    return (
      <div className={`${classes} lot-image--fallback`} role="img" aria-label={`${alt} (imagem indisponível)`}>
        <span className="t-caption">Imagem indisponível</span>
      </div>
    );
  }

  return (
    <div className={classes}>
      <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
    </div>
  );
}
